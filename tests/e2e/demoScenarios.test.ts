// The three scenarios we show judges, run through the real route handlers with the REAL login
// (email + password in, session cookie out of the response). Only the model call is mocked (no network).
// Each step asserts the status, the flags, the audit rows, and who is allowed (and refused) to act.
// scripts/demo-check.mjs runs just this file and prints PASS or FAIL per scenario.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as login } from "@/app/api/login/route";
import { POST as upload } from "@/app/api/invoices/upload/route";
import { POST as decide } from "@/app/api/invoices/[id]/decision/route";
import { GET as trail } from "@/app/api/invoices/[id]/trail/route";
import { POST as resolve } from "@/app/api/exceptions/[id]/resolve/route";
import { POST as requestBankChange } from "@/app/api/vendors/[id]/bank-change/route";
import { POST as verifyBankChange } from "@/app/api/vendors/[id]/bank-change/verify/route";
import { POST as prepare } from "@/app/api/payments/prepare/route";
import { POST as release } from "@/app/api/payments/release/route";
import { GET as eftFile } from "@/app/api/payments/eft-file/route";
import { GET as verifyAudit } from "@/app/api/audit/verify/route";
import { getDb, resetDbForTests } from "@/server/db";
import { importDataset } from "@/server/importDataset";
import { demoPassword, hashPassword } from "@/server/password";
import { signSession } from "@/server/session";

vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";
const extractMock = vi.mocked(extractInvoice);

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// Dataset users (users.csv). Ids are the numeric part of U0nn; nobody is looked up by name.
const EMPLOYEE = 13; // Aiden Grant, Operations: his department manager is user 7 (an approver)
const DEPT_MANAGER = 7; // Dev Malhotra, role approver
const CLERK = 4; // Jordan Okafor, ap_clerk
const FINANCE_MANAGER = 3; // Elise Tremblay: second chain step on big invoices, releases small ones
const CONTROLLER = 2; // Marcus Webb: manages Finance, may release anything
const CFO = 1; // Priya Raman, no manager above her
const AUDITOR = 6;
const FACILITIES_STAFF = 37; // works for user 12, who is on leave with user 3 as delegate
const ON_LEAVE_APPROVER = 12;
const TERMINATED = 15;

// One scrypt hash shared by every user keeps the suite fast (about 40 ms) while login still verifies it for real.
let passwordHash = "";
beforeAll(() => {
  passwordHash = hashPassword(demoPassword());
});

const sessions = new Map<number, string>();
beforeEach(() => {
  resetDbForTests();
  sessions.clear();
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "demo-scenarios-"));
  extractMock.mockReset();
  importDataset(getDb());
  getDb().prepare("UPDATE users SET password_hash = ?").run(passwordHash);
});

// ---- real login: POST /api/login with email and password, the cookie comes from the response ----
const loginRequest = (email: string, password: string, ip: string) =>
  new Request("http://x/api/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, password }) });
const emailOf = (userId: number) => (getDb().prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email: string }).email;

async function cookieFor(userId: number): Promise<string> {
  const cached = sessions.get(userId);
  if (cached) return cached;
  const res = await login(loginRequest(emailOf(userId), demoPassword(), `10.0.0.${userId}`));
  expect(res.status).toBe(200);
  expect(((await res.json()) as { user: { id: number } }).user.id).toBe(userId);
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  sessions.set(userId, cookie);
  return cookie;
}

const jsonInit = async (userId: number, body: unknown) => ({
  method: "POST", headers: { cookie: await cookieFor(userId), "content-type": "application/json" }, body: JSON.stringify(body),
});
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

const decideAs = async (userId: number, invoiceId: number, decision: "approved" | "rejected" = "approved") =>
  decide(new Request("http://x", await jsonInit(userId, { decision })), ctx(invoiceId));
const prepareAs = async (userId: number, invoiceId: number) => prepare(new Request("http://x", await jsonInit(userId, { invoiceId })));
const releaseAs = async (userId: number, paymentId: number) => release(new Request("http://x", await jsonInit(userId, { paymentId })));
const resolveAs = async (userId: number, invoiceId: number, action: "send_to_approval" | "reject" = "send_to_approval") =>
  resolve(new Request("http://x", await jsonInit(userId, { action, note: "demo check" })), ctx(invoiceId));
const getAs = async (userId: number) => ({ headers: { cookie: await cookieFor(userId) } });

let n = 0;
type Uploaded = { invoiceId: number; status: string; flags: { code: string; severity: string }[] };
async function uploadAs(userId: number, invoice: ExtractedInvoice): Promise<Uploaded> {
  extractMock.mockResolvedValueOnce({ status: "ok", invoice, cached: false });
  const form = new FormData();
  form.append("file", new File([`%PDF-1.4 demo scenarios ${++n}`], "invoice.pdf", { type: "application/pdf" })); // unique bytes, so no content-hash collision
  const res = await upload(new Request("http://x/api/invoices/upload", { method: "POST", ...(await getAs(userId)), body: form }));
  expect(res.status).toBe(200);
  const { results } = (await res.json()) as { results: (Uploaded & { error: string | null })[] };
  expect(results[0].error).toBeNull();
  return results[0];
}

// ---- dataset lookups, so no vendor name, number or amount is typed into the test ----
type Vendor = { id: number; name: string; i: string; t: string; a: string };
const vendor = (ext: string) =>
  getDb().prepare("SELECT id, name, bank_institution AS i, bank_transit AS t, bank_account AS a FROM vendors WHERE ext_id = ?").get(ext) as Vendor;
const bankOf = (id: number) => getDb().prepare("SELECT bank_institution AS i, bank_transit AS t, bank_account AS a FROM vendors WHERE id = ?").get(id);
const line = (description: string, amountCents: number) => ({ description, quantity: "1", unitPriceCents: amountCents, amountCents });
// Ontario ship-to, so HST at 13%: the arithmetic and the tax check both hold.
function invoiceFor(v: Vendor, number: string, lines: ReturnType<typeof line>[], extra: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  const sub = lines.reduce((s, l) => s + l.amountCents, 0);
  const tax = Math.round((sub * 13) / 100);
  return {
    vendorName: v.name, invoiceNumber: number, invoiceDate: "2026-11-05", dueDate: "2026-12-05", currency: "CAD", lines,
    taxes: [{ label: "HST 13%", code: "HST", amountCents: tax }], totalCents: sub + tax, poNumber: null, bankDetails: `${v.i}-${v.t}-${v.a}`, language: "en", ...extra,
  };
}

type Audit = { actor_id: number | null; action: string; before: string | null; after: string | null };
const auditRows = (entity: string, id: number) =>
  getDb().prepare("SELECT actor_id, action, before, after FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id").all(entity, String(id)) as Audit[];
const actions = (entity: string, id: number) => auditRows(entity, id).map((r) => r.action);
const statusTrail = (id: number) => auditRows("invoice", id).filter((r) => r.action === "invoice.status").map((r) => JSON.parse(r.after!).status);
const steps = (id: number) =>
  getDb().prepare("SELECT step_no, role, user_id, delegated_from_id, status FROM approval_steps WHERE invoice_id = ? ORDER BY step_no").all(id) as {
    step_no: number; role: string; user_id: number; delegated_from_id: number | null; status: string;
  }[];
const status = (id: number) => (getDb().prepare("SELECT status FROM invoices WHERE id = ?").get(id) as { status: string }).status;

// The whole audit log must still verify (hash chain), read through the real endpoint as the auditor.
async function expectChainVerifies() {
  const res = await verifyAudit(new Request("http://x", await getAs(AUDITOR)));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true });
}

test("scenario 1: a clean invoice goes upload to paid, each step done only by the right person, and the audit chain verifies", async () => {
  const v = vendor("V030"); // no contract, no PO needed, no bank change on record
  // A small invoice: one approver (the department manager), so the finance manager is free to release it.
  const small = await uploadAs(EMPLOYEE, invoiceFor(v, "DEMO-1-A", [line("Strategy workshop", 400_000)]));
  const id = small.invoiceId;
  expect(small.flags).toEqual([]);
  expect(small.status).toBe("pending_approval");
  expect(steps(id).map((s) => [s.role, s.user_id])).toEqual([["dept_manager", DEPT_MANAGER]]);

  // Approval: only the named approver may decide. A clerk, an auditor and a plain employee are refused by role;
  // the finance manager has the role but is not the next approver on this invoice.
  expect((await decideAs(CLERK, id)).status).toBe(403);
  expect((await decideAs(AUDITOR, id)).status).toBe(403);
  expect((await decideAs(EMPLOYEE, id)).status).toBe(403);
  const notNext = await decideAs(FINANCE_MANAGER, id);
  expect(notNext.status).toBe(403);
  expect(await errorOf(notNext)).toBe("You are not the next approver for this invoice");
  expect(status(id)).toBe("pending_approval");
  const approved = await decideAs(DEPT_MANAGER, id);
  expect(approved.status).toBe(200);
  expect(status(id)).toBe("approved");

  // Prepare: a clerk may; an approver and an employee may not. Nothing is prepared before it is approved.
  expect((await prepareAs(DEPT_MANAGER, id)).status).toBe(403);
  expect((await prepareAs(EMPLOYEE, id)).status).toBe(403);
  const prep = await prepareAs(CLERK, id);
  expect(prep.status).toBe(200);
  const { paymentId, method } = (await prep.json()) as { paymentId: number; method: string };
  expect(method).toBe("EFT");
  expect(status(id)).toBe("scheduled");

  // Release: clerk and approver never; the preparing clerk could not even if allowed; the finance manager (within limit) does.
  expect((await releaseAs(CLERK, paymentId)).status).toBe(403);
  const approverRelease = await releaseAs(DEPT_MANAGER, paymentId);
  expect(approverRelease.status).toBe(403);
  expect(await errorOf(approverRelease)).toBe("Forbidden");
  expect(status(id)).toBe("scheduled");
  const paid = await releaseAs(FINANCE_MANAGER, paymentId);
  expect(paid.status).toBe(200);
  expect(status(id)).toBe("paid");
  expect((await releaseAs(FINANCE_MANAGER, paymentId)).status).toBe(409); // settled once, never twice

  // The EFT file lists the payment.
  const csv = await (await eftFile(new Request("http://x", await getAs(AUDITOR)))).text();
  expect(csv).toContain("DEMO-1-A");
  expect(csv).toContain(`PAY-${paymentId}`);

  // Audit trail: a row for every step, with the right person on it.
  expect(actions("invoice", id)).toEqual([
    "invoice.upload", "invoice.extracted", "invoice.coding_suggestion", "invoice.routed", "invoice.checks", "invoice.status",
    "approval.decide", "invoice.status", "invoice.status", "invoice.status",
  ]);
  expect(statusTrail(id)).toEqual(["pending_approval", "approved", "scheduled", "paid"]);
  expect(auditRows("invoice", id).find((r) => r.action === "approval.decide")!.actor_id).toBe(DEPT_MANAGER);
  expect(auditRows("payment", paymentId).map((r) => [r.action, r.actor_id])).toEqual([["payment.prepare", CLERK], ["payment.release", FINANCE_MANAGER]]);
  const shown = await trail(new Request("http://x", await getAs(AUDITOR)), ctx(id));
  expect(shown.status).toBe(200);
  expect(((await shown.json()) as { action: string }[]).map((r) => r.action)).toContain("payment.release");

  // A bigger invoice adds the finance manager to the chain by amount, and that approver may then no longer release it.
  const big = await uploadAs(EMPLOYEE, invoiceFor(v, "DEMO-1-B", [line("Strategy workshop", 700_000), line("Report", 407_300)]));
  expect(big.flags).toEqual([]);
  expect(steps(big.invoiceId).map((s) => [s.role, s.user_id])).toEqual([["dept_manager", DEPT_MANAGER], ["finance_manager", FINANCE_MANAGER]]);
  for (const s of steps(big.invoiceId)) expect((await decideAs(s.user_id, big.invoiceId)).status).toBe(200);
  expect(status(big.invoiceId)).toBe("approved");
  const bigPay = ((await (await prepareAs(CLERK, big.invoiceId)).json()) as { paymentId: number }).paymentId;
  const selfRelease = await releaseAs(FINANCE_MANAGER, bigPay);
  expect(selfRelease.status).toBe(403);
  expect(await errorOf(selfRelease)).toBe("You approved this invoice, so you cannot release its payment");
  expect((await releaseAs(CONTROLLER, bigPay)).status).toBe(200);
  expect(status(big.invoiceId)).toBe("paid");

  await expectChainVerifies();
});

test("scenario 2: changed bank details are held, cannot be approved, and proceed only after a finance user verifies the change", async () => {
  const v = vendor("V030");
  const before = bankOf(v.id);
  // Same vendor, but the invoice shows another account (last digit changed).
  const other = v.a.slice(0, -1) + ((Number(v.a.slice(-1)) + 1) % 10);
  const held = await uploadAs(EMPLOYEE, invoiceFor(v, "DEMO-2-A", [line("Advisory", 400_000)], { bankDetails: null, bankInstitution: v.i, bankTransit: v.t, bankAccount: other }));
  const id = held.invoiceId;
  expect(held.status).toBe("needs_review");
  expect(held.flags.find((f) => f.code === "bank_details_differ")).toMatchObject({ severity: "error" });
  expect(bankOf(v.id)).toEqual(before); // reading an invoice never edits the vendor master
  expect(steps(id)).toEqual([]);
  expect(JSON.parse(auditRows("invoice", id).find((r) => r.action === "invoice.checks")!.after!).flags.map((f: { code: string }) => f.code)).toContain("bank_details_differ");

  // Held means held: nobody can approve it, a clerk cannot push it through, and no payment can be prepared.
  expect((await decideAs(DEPT_MANAGER, id)).status).toBe(404); // no chain exists, so the invoice is invisible to an approver
  const pushed = await resolveAs(CLERK, id);
  expect(pushed.status).toBe(409);
  expect(await errorOf(pushed)).toContain("A finance user must verify a bank change first");
  expect((await prepareAs(CLERK, id)).status).toBe(409);
  expect(status(id)).toBe("needs_review");

  // Bank-change workflow: an employee cannot start it; a clerk asks; the clerk cannot confirm their own request, a finance user does.
  const body = { institution: v.i, transit: v.t, account: other, channel: "phone_callback" };
  expect((await requestBankChange(new Request("http://x", await jsonInit(EMPLOYEE, body)), ctx(v.id))).status).toBe(403);
  expect((await requestBankChange(new Request("http://x", await jsonInit(CLERK, body)), ctx(v.id))).status).toBe(201);
  expect(bankOf(v.id)).toEqual(before); // a request alone changes nothing
  const verifyCall = async (userId: number) => verifyBankChange(new Request("http://x", await jsonInit(userId, { verified: true })), ctx(v.id));
  expect((await verifyCall(CLERK)).status).toBe(403);
  expect((await verifyCall(DEPT_MANAGER)).status).toBe(403);
  expect(bankOf(v.id)).toEqual(before);
  expect((await verifyCall(FINANCE_MANAGER)).status).toBe(200);
  expect(bankOf(v.id)).toEqual({ i: v.i, t: v.t, a: other });
  expect(auditRows("vendor", v.id).map((r) => [r.action, r.actor_id])).toEqual([["vendor.bank_updated", FINANCE_MANAGER]]);

  // Only now can the held invoice go to approval, and it then follows the normal chain to paid.
  expect((await resolveAs(CLERK, id)).status).toBe(200);
  expect(status(id)).toBe("pending_approval");
  expect(steps(id).map((s) => [s.role, s.user_id])).toEqual([["dept_manager", DEPT_MANAGER]]);
  expect((await decideAs(DEPT_MANAGER, id)).status).toBe(200);
  const paymentId = ((await (await prepareAs(CLERK, id)).json()) as { paymentId: number }).paymentId;
  expect((await releaseAs(FINANCE_MANAGER, paymentId)).status).toBe(200);
  expect(status(id)).toBe("paid");
  expect(statusTrail(id)).toEqual(["needs_review", "pending_approval", "approved", "scheduled", "paid"]);
  expect(actions("invoice", id)).toContain("exception.resolve");
  expect(auditRows("invoice", id).find((r) => r.action === "exception.resolve")!.actor_id).toBe(CLERK);

  // The inbox case: a vendor whose bank change came by email and was never verified by callback stays held, and nothing edits its details.
  const v4 = vendor("V004");
  const v4Bank = bankOf(v4.id);
  const email = await uploadAs(EMPLOYEE, invoiceFor(v4, "DEMO-2-B", [line("Linehaul", 1_000_000)]));
  expect(email.status).toBe("needs_review");
  expect(email.flags.map((f) => f.code)).toContain("bank_change_unverified");
  expect(bankOf(v4.id)).toEqual(v4Bank);
  expect(getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'vendor.bank_updated' AND entity_id = ?").get(String(v4.id))).toBeUndefined();
  expect((await decideAs(DEPT_MANAGER, email.invoiceId)).status).toBe(404);

  await expectChainVerifies();
});

test("scenario 3: self-approval is refused and escalated, leave goes to the delegate, a terminated user cannot log in, an approver cannot release", async () => {
  const v = vendor("V030");

  // The requester is the department manager, so the rule sends the chain to their own manager.
  const own = await uploadAs(CONTROLLER, invoiceFor(v, "DEMO-3-A", [line("Advisory", 500_000)]));
  const id = own.invoiceId;
  expect(own.flags).toEqual([]);
  expect(steps(id)).toMatchObject([{ role: "dept_manager", user_id: CFO }]);
  const self = await decideAs(CONTROLLER, id);
  expect(self.status).toBe(403);
  expect(await errorOf(self)).toBe("You cannot decide an invoice you requested");
  expect(status(id)).toBe("pending_approval");
  expect(auditRows("invoice", id).filter((r) => r.action === "approval.decide")).toEqual([]); // a refusal is not a decision
  expect((await decideAs(CFO, id)).status).toBe(200);
  expect(auditRows("invoice", id).find((r) => r.action === "approval.decide")!.actor_id).toBe(CFO);
  expect(status(id)).toBe("approved");

  // An approver (a role that may approve, never pay) tries to release and is refused; the invoice stays scheduled.
  const paymentId = ((await (await prepareAs(CLERK, id)).json()) as { paymentId: number }).paymentId;
  const approverRelease = await releaseAs(DEPT_MANAGER, paymentId);
  expect(approverRelease.status).toBe(403);
  expect(await errorOf(approverRelease)).toBe("Forbidden");
  expect(status(id)).toBe("scheduled");
  expect(auditRows("payment", paymentId).map((r) => r.action)).toEqual(["payment.prepare"]);

  // An approver on leave: the step goes to the delegate, who decides, and the audit row says on whose behalf.
  const leave = await uploadAs(FACILITIES_STAFF, invoiceFor(v, "DEMO-3-B", [line("Maintenance", 300_000)]));
  expect(steps(leave.invoiceId)).toMatchObject([{ role: "dept_manager", user_id: FINANCE_MANAGER, delegated_from_id: ON_LEAVE_APPROVER }]);
  const onLeave = await decideAs(ON_LEAVE_APPROVER, leave.invoiceId);
  expect(onLeave.status).toBe(404); // the step is the delegate's, so the invoice is invisible to the approver on leave
  expect(await errorOf(onLeave)).toBe("Invoice not found");
  const delegated = await decideAs(FINANCE_MANAGER, leave.invoiceId);
  expect(delegated.status).toBe(200);
  expect(await delegated.json()).toMatchObject({ delegated: true, delegatedFromId: ON_LEAVE_APPROVER });
  const row = auditRows("invoice", leave.invoiceId).find((r) => r.action === "approval.decide")!;
  expect(row.actor_id).toBe(FINANCE_MANAGER);
  expect(JSON.parse(row.after!)).toMatchObject({ delegated: true, delegatedFromId: ON_LEAVE_APPROVER });
  expect(status(leave.invoiceId)).toBe("approved");

  // A terminated user cannot log in (same words as a wrong password, so nothing leaks), and an old cookie stops working at once.
  const dead = await login(loginRequest(emailOf(TERMINATED), demoPassword(), "10.9.9.9"));
  expect(dead.status).toBe(401);
  expect(await errorOf(dead)).toBe("Invalid email or password");
  expect(dead.headers.get("set-cookie")).toBeNull();
  const failed = getDb().prepare("SELECT after FROM audit_log WHERE action = 'login_failed' AND entity_id = ?").get(String(TERMINATED)) as { after: string };
  expect(JSON.parse(failed.after).outcome).toBe("terminated"); // the audit log says why, the response does not
  const stale = await verifyAudit(new Request("http://x", { headers: { cookie: `session=${signSession(TERMINATED)}` } }));
  expect(stale.status).toBe(401);

  await expectChainVerifies();
});

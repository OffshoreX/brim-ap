// End-to-end demo path through the real route handlers: real imported dataset in an in-memory DB,
// only the model call is mocked (no network). Each scenario asserts the audit trail as well as the result.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as upload } from "@/app/api/invoices/upload/route";
import { POST as processInvoice } from "@/app/api/invoices/[id]/process/route";
import { POST as decide } from "@/app/api/invoices/[id]/decision/route";
import { POST as prepare } from "@/app/api/payments/prepare/route";
import { POST as release } from "@/app/api/payments/release/route";
import { GET as eftFile } from "@/app/api/payments/eft-file/route";
import { getDb, resetDbForTests } from "@/server/db";
import { importDataset } from "@/server/importDataset";
import { signSession } from "@/server/session";

vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";
const extractMock = vi.mocked(extractInvoice);

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// Dataset users (users.csv): who plays which part.
const EMPLOYEE = 13; // Aiden Grant, Operations, works in ON; his department manager is U007 (an approver)
const CLERK = 4; // Jordan Okafor, ap_clerk
const FINANCE_MANAGER = 3; // Elise Tremblay: the second chain step on invoices over the finance threshold
const CONTROLLER = 2; // Marcus Webb: may release, and manages the Finance department
const CFO = 1; // Priya Raman, controller_admin with no manager
const AUDITOR = 6;

beforeEach(() => {
  resetDbForTests();
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
  extractMock.mockReset();
  importDataset(getDb());
});

// ---- tiny HTTP helpers around the real handlers ----
const as = (userId: number) => ({ cookie: `session=${signSession(userId)}` });
const post = (url: string, userId: number, body: unknown) =>
  new Request(url, { method: "POST", headers: { ...as(userId), "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

let n = 0;
async function uploadAs(userId: number): Promise<number> {
  const form = new FormData();
  // Unique bytes per call so the content hash never collapses two invoices into one.
  form.append("file", new File([`%PDF-1.4 e2e ${++n}`], "invoice.pdf", { type: "application/pdf" }));
  const res = await upload(new Request("http://x/api/invoices/upload", { method: "POST", headers: as(userId), body: form }));
  expect(res.status).toBe(200);
  return (await res.json())[0].invoiceId;
}
async function processAs(userId: number, invoiceId: number, invoice: ExtractedInvoice) {
  extractMock.mockResolvedValueOnce({ status: "ok", invoice, cached: false });
  const res = await processInvoice(post("http://x", userId, {}), ctx(invoiceId));
  expect(res.status).toBe(200);
  return res.json() as Promise<{ status: string; flags: { code: string; severity: string }[] }>;
}

// ---- dataset lookups, so no vendor name or number is typed into the test ----
const vendor = (ext: string) =>
  getDb().prepare("SELECT id, name, bank_institution AS i, bank_transit AS t, bank_account AS a FROM vendors WHERE ext_id = ?").get(ext) as {
    id: number; name: string; i: string; t: string; a: string;
  };
const bankText = (v: ReturnType<typeof vendor>) => `${v.i}-${v.t}-${v.a}`;
const line = (description: string, amountCents: number) => ({ description, quantity: "1", unitPriceCents: amountCents, amountCents });
// ON ship-to, so HST at 13%: the arithmetic and the tax check both hold.
function invoiceFor(v: ReturnType<typeof vendor>, number: string, lines: ReturnType<typeof line>[], extra: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  const sub = lines.reduce((s, l) => s + l.amountCents, 0);
  const tax = Math.round((sub * 13) / 100);
  return {
    vendorName: v.name, invoiceNumber: number, invoiceDate: "2026-11-05", dueDate: "2026-12-05", currency: "CAD", lines,
    taxes: [{ label: "HST 13%", code: "HST", amountCents: tax }], totalCents: sub + tax, poNumber: null, bankDetails: bankText(v), language: "en", ...extra,
  };
}

const auditRows = (entity: string, id: number) =>
  (getDb().prepare("SELECT actor_id, action, before, after FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id").all(entity, String(id)) as {
    actor_id: number | null; action: string; before: string | null; after: string | null;
  }[]);
const actions = (entity: string, id: number) => auditRows(entity, id).map((r) => r.action);
const statusTrail = (id: number) => auditRows("invoice", id).filter((r) => r.action === "invoice.status").map((r) => JSON.parse(r.after!).status);
const steps = (id: number) =>
  getDb().prepare("SELECT step_no, role, user_id, reason, status FROM approval_steps WHERE invoice_id = ? ORDER BY step_no").all(id) as {
    step_no: number; role: string; user_id: number; reason: string; status: string;
  }[];
const status = (id: number) => (getDb().prepare("SELECT status FROM invoices WHERE id = ?").get(id) as { status: string }).status;

test("(a) a clean invoice goes upload, process, every chain step, prepare, release, paid, and shows in the EFT file", async () => {
  const v = vendor("V030"); // no contract, no PO needed, no bank change on record
  const id = await uploadAs(EMPLOYEE);
  const body = await processAs(CLERK, id, invoiceFor(v, "E2E-A-1", [line("Strategy workshop", 700_000), line("Report", 407_300)]));
  expect(body.flags.filter((f) => f.severity === "error")).toEqual([]);
  expect(body.status).toBe("pending_approval");

  // Over the finance threshold, so two steps: the department manager, then the finance manager.
  const chain = steps(id);
  expect(chain.map((s) => [s.role, s.user_id])).toEqual([["dept_manager", 7], ["finance_manager", FINANCE_MANAGER]]);
  // Only the next approver may decide: the finance manager going first is refused by the server.
  expect((await decide(post("http://x", FINANCE_MANAGER, { decision: "approved" }), ctx(id))).status).toBe(403);
  for (const s of chain) {
    const res = await decide(post("http://x", s.user_id, { decision: "approved" }), ctx(id));
    expect(res.status).toBe(200);
  }
  expect(status(id)).toBe("approved");

  const prep = await prepare(post("http://x", CLERK, { invoiceId: id }));
  expect(prep.status).toBe(200);
  const { paymentId } = await prep.json();
  expect(status(id)).toBe("scheduled");
  // Separation of duties and roles, enforced on the server: the clerk and an approver of this invoice cannot release it.
  expect((await release(post("http://x", CLERK, { paymentId }))).status).toBe(403);
  expect((await release(post("http://x", FINANCE_MANAGER, { paymentId }))).status).toBe(403);
  const paid = await release(post("http://x", CONTROLLER, { paymentId }));
  expect(paid.status).toBe(200);
  expect(status(id)).toBe("paid");

  const csv = await (await eftFile(new Request("http://x", { headers: as(AUDITOR) }))).text();
  expect(csv).toContain("E2E-A-1");
  expect(csv).toContain(`PAY-${paymentId}`);

  // An audit row for every step, with the right person on it.
  expect(actions("invoice", id)).toEqual([
    "invoice.upload", "invoice.extracted", "invoice.coding_suggestion", "invoice.routed", "invoice.checks", "invoice.status",
    "approval.decide", "approval.decide", "invoice.status", "invoice.status", "invoice.status",
  ]);
  expect(statusTrail(id)).toEqual(["pending_approval", "approved", "scheduled", "paid"]);
  expect(auditRows("invoice", id).filter((r) => r.action === "approval.decide").map((r) => r.actor_id)).toEqual([7, FINANCE_MANAGER]);
  expect(auditRows("payment", paymentId).map((r) => [r.action, r.actor_id])).toEqual([["payment.prepare", CLERK], ["payment.release", CONTROLLER]]);
});

test("(b) the invoice from V004 with an unverified email bank change is held in needs_review with a bank flag", async () => {
  const v = vendor("V004"); // bank_change_history BC-009: email_request, not verified by callback
  const id = await uploadAs(EMPLOYEE);
  const body = await processAs(CLERK, id, invoiceFor(v, "E2E-B-1", [line("Linehaul", 1_000_000), line("Fuel surcharge (8%)", 80_000)]));
  expect(body.status).toBe("needs_review");
  expect(body.flags.map((f) => f.code)).toContain("bank_change_unverified");
  expect(status(id)).toBe("needs_review");
  // Held means held: no approval chain exists and a decision is refused.
  expect(steps(id)).toEqual([]);
  expect((await decide(post("http://x", 7, { decision: "approved" }), ctx(id))).status).toBe(409);
  const checks = auditRows("invoice", id).find((r) => r.action === "invoice.checks")!;
  expect(JSON.parse(checks.after!).flags.map((f: { code: string }) => f.code)).toContain("bank_change_unverified");
  expect(statusTrail(id)).toEqual(["needs_review"]);
});

test("(c) a requester who is also the department manager is rerouted to their own manager, and cannot approve", async () => {
  const v = vendor("V030");
  const id = await uploadAs(CONTROLLER); // Marcus manages Finance, so as requester he would be the first approver
  const body = await processAs(CLERK, id, invoiceFor(v, "E2E-C-1", [line("Advisory", 500_000)]));
  expect(body.status).toBe("pending_approval");
  const [first, ...rest] = steps(id);
  expect(rest).toEqual([]);
  expect(first).toMatchObject({ role: "dept_manager", user_id: CFO });
  expect(first.reason).toContain("P07");
  // The server refuses the requester even though his role is allowed to decide invoices.
  const self = await decide(post("http://x", CONTROLLER, { decision: "approved" }), ctx(id));
  expect(self.status).toBe(403);
  expect((await decide(post("http://x", CFO, { decision: "approved" }), ctx(id))).status).toBe(200);
  expect(status(id)).toBe("approved");
  const routed = auditRows("invoice", id).find((r) => r.action === "invoice.routed")!;
  expect(JSON.parse(routed.after!).steps[0].reason).toContain("P07");
  expect(auditRows("invoice", id).find((r) => r.action === "approval.decide")!.actor_id).toBe(CFO);
});

test("(d) an unverified copy of a historical invoice lands in needs_review as an exact duplicate", async () => {
  const hist = getDb()
    .prepare("SELECT i.invoice_number AS number, i.total_cents AS total, i.invoice_date AS date, v.name FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.currency = 'CAD' ORDER BY i.id LIMIT 1")
    .get() as { number: string; total: number; date: string; name: string };
  const id = await uploadAs(EMPLOYEE);
  const copy: ExtractedInvoice = {
    vendorName: hist.name, invoiceNumber: hist.number, invoiceDate: hist.date, dueDate: null, currency: "CAD",
    lines: [line("Same as before", hist.total)], taxes: [], totalCents: hist.total, poNumber: null, bankDetails: null, language: "en",
  };
  const body = await processAs(CLERK, id, copy);
  expect(body.status).toBe("needs_review");
  expect(body.flags.find((f) => f.code === "DUPLICATE_EXACT")).toMatchObject({ severity: "error" });
  expect(status(id)).toBe("needs_review");
  expect(steps(id)).toEqual([]);
  expect(actions("invoice", id)).toEqual(["invoice.upload", "invoice.extracted", "invoice.coding_suggestion", "invoice.checks", "invoice.status"]);
});

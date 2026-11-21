// T57: a double click, or two users at once, must never double pay, double approve or double create.
// Real route handlers, real SQLite (in memory). "Parallel" = Promise.all of two requests; better-sqlite3 is synchronous, so
// each action's read-check-write runs as one uninterrupted block, which is exactly what the 409 paths rely on.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as upload } from "@/app/api/invoices/upload/route";
import { POST as decide } from "@/app/api/invoices/[id]/decision/route";
import { POST as resolve } from "@/app/api/exceptions/[id]/resolve/route";
import { POST as requestBankChange } from "@/app/api/vendors/[id]/bank-change/route";
import { POST as verifyBankChange } from "@/app/api/vendors/[id]/bank-change/verify/route";
import { POST as prepare } from "@/app/api/payments/prepare/route";
import { POST as release } from "@/app/api/payments/release/route";
import { GET as eftFile } from "@/app/api/payments/eft-file/route";
import { applySchema, getDb, resetDbForTests } from "@/server/db";
import { importDataset } from "@/server/importDataset";
import { signSession } from "@/server/session";

vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";
const extractMock = vi.mocked(extractInvoice);

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const EMP = 1, APPR = 3, FIN = 5, FIN2 = 6, CLERK = 7, CTRL = 8;
const good: ExtractedInvoice = {
  vendorName: "Acme", invoiceNumber: "INV-100", invoiceDate: "2026-11-01", dueDate: null, currency: "CAD",
  lines: [{ description: "Freight", quantity: "2", unitPriceCents: 5000, amountCents: 10000 }],
  taxes: [{ label: "HST 13%", code: "HST", amountCents: 1300 }], totalCents: 11300, poNumber: null, bankDetails: null, language: "en",
};

beforeEach(() => {
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "double-action-"));
  resetDbForTests();
  extractMock.mockReset();
  extractMock.mockResolvedValue({ status: "ok", invoice: good, cached: false });
  getDb().exec(`
    INSERT INTO users (id,name,role,approval_limit_cents) VALUES
      (1,'Emp','employee',0),(3,'Appr','approver',100000000),(5,'Fin','finance_manager',0),(6,'Fin2','finance_manager',0),(7,'Clerk','ap_clerk',0),(8,'Ctrl','controller_admin',0);
    INSERT INTO departments (id,name,manager_user_id) VALUES (1,'Ops',3);
    UPDATE users SET department_id = 1, manager_id = 3 WHERE id = 1;
    INSERT INTO approval_rules (policy_id,over_cents,extra_role) VALUES ('P2',1000000,'finance_manager'),('P3',5000000,'controller_admin'),('P4',20000000,'cfo');
    INSERT INTO vendors (id,name,bank_institution,bank_transit,bank_account) VALUES (1,'Acme','001','11111','12345678');
    -- 10-12 approved (ready to prepare); 20 has a two-step chain; 21-22 one step; 30 is held for review
    INSERT INTO invoices (id,status,vendor_id,requester_id,invoice_number,invoice_date,total_cents,currency,flags) VALUES
      (10,'approved',1,1,'INV-10','2026-01-01',10000,'CAD','[]'),(11,'approved',1,1,'INV-11','2026-01-01',10000,'CAD','[]'),
      (12,'approved',1,1,'INV-12','2026-01-01',10000,'CAD','[]'),
      (20,'pending_approval',1,1,'INV-20','2026-01-01',10000,'CAD','[]'),(21,'pending_approval',1,1,'INV-21','2026-01-01',10000,'CAD','[]'),
      (22,'pending_approval',1,1,'INV-22','2026-01-01',10000,'CAD','[]'),(30,'needs_review',1,1,'INV-30','2026-01-01',10000,'CAD','[]');
    INSERT INTO approval_steps (invoice_id,step_no,role,user_id) VALUES
      (20,1,'dept_manager',3),(20,2,'finance_manager',5),(21,1,'dept_manager',3),(22,1,'dept_manager',3);
  `);
});

const cookie = (user: number) => ({ cookie: `session=${signSession(user)}`, "content-type": "application/json" });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const post = (user: number, body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { ...cookie(user), ...headers } });
const decideAs = (user: number, id: number, decision: "approved" | "rejected") => decide(post(user, { decision }), ctx(id));
const prepareAs = (user: number, invoiceId: number, headers?: Record<string, string>) => prepare(post(user, { invoiceId }, headers));
const releaseAs = (user: number, paymentId: number, headers?: Record<string, string>) => release(post(user, { paymentId }, headers));
const resolveAs = (user: number, id: number, action: "send_to_approval" | "reject") => resolve(post(user, { action, note: "x" }), ctx(id));
const verifyAs = (user: number, verified = true) => verifyBankChange(post(user, { verified }), ctx(1));
const NEW_BANK = { institution: "002", transit: "22222", account: "99990000", channel: "email_request" };
const uploadAs = (user: number, files: Buffer[], headers: Record<string, string> = {}) => {
  const form = new FormData();
  files.forEach((b, i) => form.append("file", new File([new Uint8Array(b)], `f${i}.pdf`, { type: "application/pdf" })));
  return upload(new Request("http://x/api/invoices/upload", { method: "POST", body: form, headers: { cookie: cookie(user).cookie, ...headers } }));
};

const count = (sql: string, ...args: unknown[]) => (getDb().prepare(sql).get(...args) as { n: number }).n;
const codes = (rs: Response[]) => rs.map((r) => r.status).sort();
const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`);
// Prepares an approved invoice as the clerk and returns the payment id.
const prepared = async (invoiceId: number) => ((await (await prepareAs(CLERK, invoiceId)).json()) as { paymentId: number }).paymentId;
const eftLines = async () => (await (await eftFile(new Request("http://x", { headers: cookie(FIN) }))).text()).trim().split("\n").length - 1;

// ---- release payment ----
test("release twice in a row: the second is 409 and leaves no second payment, EFT line or audit row", async () => {
  const pid = await prepared(10);
  expect((await releaseAs(FIN, pid)).status).toBe(200);
  const again = await releaseAs(FIN, pid);
  expect(again.status).toBe(409);
  expect(((await again.json()) as { error: string }).error).toMatch(/settled/);
  expect(count("SELECT COUNT(*) n FROM payments WHERE invoice_id = 10")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'payment.release'")).toBe(1);
  expect(await eftLines()).toBe(1);
});

test("release by two users at once: exactly one wins", async () => {
  const pid = await prepared(10);
  expect(codes(await Promise.all([releaseAs(FIN, pid), releaseAs(FIN2, pid)]))).toEqual([200, 409]);
  expect(count("SELECT COUNT(*) n FROM payments WHERE invoice_id = 10")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'payment.release'")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'invoice.status' AND entity_id = '10' AND after LIKE '%paid%'")).toBe(1);
  expect(await eftLines()).toBe(1);
});

// ---- prepare payment ----
test("prepare twice in a row, and in parallel: one payment row", async () => {
  expect(codes([await prepareAs(CLERK, 10), await prepareAs(CLERK, 10)])).toEqual([200, 409]);
  expect(codes(await Promise.all([prepareAs(CLERK, 11), prepareAs(CTRL, 11)]))).toEqual([200, 409]);
  expect(count("SELECT COUNT(*) n FROM payments")).toBe(2);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'payment.prepare'")).toBe(2);
});

test("the database itself refuses a second payment for one invoice, but keeps the dataset's own historical doubles", () => {
  const db = getDb();
  const ins = db.prepare("INSERT INTO payments (invoice_id, amount_cents, currency, ext_id) VALUES (?, 1, 'CAD', ?)");
  ins.run(10, null);
  expect(() => ins.run(10, null)).toThrow(/UNIQUE/);
  ins.run(11, "AP-1"); // imported rows have an ext_id; dataset payments.csv really has invoices paid twice
  ins.run(11, "AP-2");
});

// ---- approve / reject ----
test("approve the same step twice: the second is 409 and no second approval row", async () => {
  expect((await decideAs(APPR, 20, "approved")).status).toBe(200);
  const again = await decideAs(APPR, 20, "approved");
  expect(again.status).toBe(409);
  expect(((await again.json()) as { error: string }).error).toMatch(/already decided/);
  expect(count("SELECT COUNT(*) n FROM approvals WHERE invoice_id = 20")).toBe(1);
  // a stranger is still a 403, only a repeat by someone who already decided is a 409
  expect((await decideAs(CTRL, 20, "approved")).status).toBe(403);
});

test("approve twice at once: one 200, one 409, one approval row, one audit row", async () => {
  expect(codes(await Promise.all([decideAs(APPR, 21, "approved"), decideAs(APPR, 21, "approved")]))).toEqual([200, 409]);
  expect(count("SELECT COUNT(*) n FROM approvals WHERE invoice_id = 21")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'approval.decide' AND entity_id = '21'")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'invoice.status' AND entity_id = '21' AND after LIKE '%approved%'")).toBe(1);
});

test("approve after reject, reject after approve, and both at once: always one decision", async () => {
  expect((await decideAs(APPR, 21, "rejected")).status).toBe(200);
  expect((await decideAs(APPR, 21, "approved")).status).toBe(409);
  expect(count("SELECT COUNT(*) n FROM approvals WHERE invoice_id = 21")).toBe(1);
  expect(codes(await Promise.all([decideAs(APPR, 22, "approved"), decideAs(APPR, 22, "rejected")]))).toEqual([200, 409]);
  expect(count("SELECT COUNT(*) n FROM approvals WHERE invoice_id = 22")).toBe(1);
});

test("the database itself refuses two decisions for one step", () => {
  const ins = getDb().prepare("INSERT INTO approvals (invoice_id, step_no, approver_id, decision) VALUES (20, 1, 3, 'approved')");
  ins.run();
  expect(() => ins.run()).toThrow(/UNIQUE/);
});

// ---- exception resolve ----
test("resolve an exception twice, and at once: the second is 409, one chain, one audit row", async () => {
  expect(codes([await resolveAs(CLERK, 30, "send_to_approval"), await resolveAs(CLERK, 30, "send_to_approval")])).toEqual([200, 409]);
  getDb().prepare("UPDATE invoices SET status = 'needs_review', flags = '[]' WHERE id = 30").run();
  getDb().prepare("DELETE FROM approval_steps WHERE invoice_id = 30").run();
  const before = count("SELECT COUNT(*) n FROM audit_log WHERE action = 'exception.resolve'");
  expect(codes(await Promise.all([resolveAs(CLERK, 30, "reject"), resolveAs(CTRL, 30, "send_to_approval")]))).toEqual([200, 409]);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'exception.resolve'")).toBe(before + 1);
});

// ---- bank-change verify ----
test("verify a bank change twice, and at once: applied once", async () => {
  expect((await requestBankChange(post(CLERK, NEW_BANK), ctx(1))).status).toBe(201);
  expect(codes(await Promise.all([verifyAs(FIN), verifyAs(FIN2)]))).toEqual([200, 409]);
  expect((await verifyAs(FIN)).status).toBe(409);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'vendor.bank_change_verified'")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'vendor.bank_updated'")).toBe(1);
  expect((await verifyBankChange(post(FIN, { verified: true }), ctx(999))).status).toBe(404); // unknown vendor stays 404
});

test("only one bank-change request can be open per vendor, in the handler and in the database", async () => {
  expect((await requestBankChange(post(CLERK, NEW_BANK), ctx(1))).status).toBe(201);
  expect(codes([await requestBankChange(post(CLERK, NEW_BANK), ctx(1))])).toEqual([409]);
  expect(() =>
    getDb().prepare("INSERT INTO vendor_bank_changes (vendor_id, changed_at, status) VALUES (1, '2026-01-01', 'pending')").run()
  ).toThrow(/UNIQUE/);
});

// ---- upload ----
test("the same bytes uploaded in two parallel requests (or twice in one) make one invoice", async () => {
  const same = pdf("same bytes");
  const res = await Promise.all([uploadAs(EMP, [same]), uploadAs(EMP, [same]), uploadAs(EMP, [same, same])]);
  expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(count("SELECT COUNT(*) n FROM invoices WHERE source_file IS NOT NULL")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'invoice.upload'")).toBe(1);
  expect(extractMock).toHaveBeenCalledTimes(1);
});

// ---- Idempotency-Key ----
test("Idempotency-Key on release: the same key returns the first response, with no second payment", async () => {
  const pid = await prepared(10);
  const key = { "idempotency-key": "rel-1" };
  const [a, b] = await Promise.all([releaseAs(FIN, pid, key), releaseAs(FIN, pid, key)]);
  expect([a.status, b.status]).toEqual([200, 200]);
  expect(await b.json()).toEqual(await a.json());
  expect((await releaseAs(FIN, pid, key)).status).toBe(200); // later retry too
  expect((await releaseAs(FIN, pid)).status).toBe(409); // no key: a plain repeat is refused
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'payment.release'")).toBe(1);
  expect(await eftLines()).toBe(1);
});

test("Idempotency-Key on prepare: replays the first response; a key is per user and per request", async () => {
  const key = { "idempotency-key": "prep-1" };
  const first = await prepareAs(CLERK, 10, key);
  const second = await prepareAs(CLERK, 10, key);
  expect(await second.json()).toEqual(await first.json());
  expect(count("SELECT COUNT(*) n FROM payments")).toBe(1);
  expect((await prepareAs(CLERK, 11, key)).status).toBe(409); // same key, different request
  expect(count("SELECT COUNT(*) n FROM payments")).toBe(1);
  expect((await prepareAs(CTRL, 11, key)).status).toBe(200); // another user's key is a different key
});

test("Idempotency-Key on upload: the same key returns the first response and processes once", async () => {
  const key = { "idempotency-key": "up-1" };
  const [a, b] = await Promise.all([uploadAs(EMP, [pdf("one")], key), uploadAs(EMP, [pdf("one")], key)]);
  expect(await b.json()).toEqual(await a.json());
  expect((await uploadAs(EMP, [pdf("one")], key)).status).toBe(200);
  expect(count("SELECT COUNT(*) n FROM invoices WHERE source_file IS NOT NULL")).toBe(1);
  expect(extractMock).toHaveBeenCalledTimes(1);
  expect((await uploadAs(EMP, [pdf("two")], key)).status).toBe(409); // same key, different files
});

// ---- migration ----
test("the safety migration works on a populated database and can be applied again", () => {
  const db = getDb();
  importDataset(db); // dataset payments hold three doubles; the partial index must not choke on them
  applySchema(db);
  const names = () => (db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'uq_%' OR name = 'idempotency_keys'").all() as { name: string }[]).map((r) => r.name).sort();
  const expected = ["idempotency_keys", "uq_approvals_one_per_step", "uq_bank_change_one_pending", "uq_payments_one_per_invoice"];
  expect(names()).toEqual(expected);
  // A database from before this ticket: indexes missing, rows present. Applying the schema adds them.
  for (const n of expected.filter((n) => n.startsWith("uq_"))) db.exec(`DROP INDEX ${n}`);
  db.exec("DROP TABLE idempotency_keys");
  applySchema(db);
  expect(names()).toEqual(expected);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as processRoute } from "@/app/api/invoices/[id]/process/route";
import { PATCH as codingRoute } from "@/app/api/invoices/[id]/lines/[lineId]/coding/route";
import { POST as decideRoute } from "@/app/api/invoices/[id]/decision/route";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";

// No network: the extractor is replaced for every test.
vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";
const extractMock = vi.mocked(extractInvoice);

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const EMP = 1, CLERK = 2, APPROVER = 3, FINANCE = 5;
const base: ExtractedInvoice = {
  vendorName: "ACME Freight Inc", invoiceNumber: "INV-1", invoiceDate: "2026-11-01", dueDate: null, currency: "CAD",
  lines: [
    { description: "Fuel surcharge 12%", quantity: "1", unitPriceCents: 1000, amountCents: 1000 },
    { description: "Linehaul freight", quantity: "1", unitPriceCents: 9000, amountCents: 9000 },
  ],
  taxes: [{ label: "HST 13%", code: "HST", amountCents: 1300 }], totalCents: 11300, poNumber: null, bankDetails: null, language: "en",
};
let dir: string;
let n = 0;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-"));
  resetDbForTests();
  extractMock.mockReset();
  getDb().exec(`
    INSERT INTO users (id,name,role,approval_limit_cents) VALUES
      (1,'Emp','employee',0),(2,'Clerk','ap_clerk',0),(3,'Appr','approver',100000000),(4,'Aud','auditor',0),(5,'Fin','finance_manager',100000000);
    UPDATE users SET province = 'ON';
    INSERT INTO departments (id,name,manager_user_id) VALUES (1,'Ops',3),(2,'IT',3);
    UPDATE users SET department_id = 1, manager_id = 3 WHERE id = 1;
    INSERT INTO approval_policies (ext_id,rule_type,condition,required) VALUES
      ('P02','approval','Invoice total over $10,000 CAD','dept_manager > finance_manager'),
      ('P03','approval','Invoice total over $50,000 CAD','dept_manager > finance_manager > controller_admin'),
      ('P04','approval','Invoice total over $250,000 CAD','dept_manager > finance_manager > controller_admin > cfo');
    INSERT INTO gl_accounts (id,code,name) VALUES (5010,'5010','Freight'),(5020,'5020','Fuel'),(6110,'6110','Software');
    INSERT INTO tax_codes (code,province,rate_bps,applies_to) VALUES ('HST13','ON',1300,'all'),('GST5','AB',500,'all'),('PST7_BC','BC',700,'goods'),('QST9975','QC',997.5,'all'),('EXEMPT',NULL,0,'all');
    INSERT INTO vendors (id,name,default_gl_account) VALUES (1,'ACME Freight Inc','5010'),(2,'New Vendor Ltd',NULL);
    -- history: fuel lines were coded 5020 and freight lines 5010, with HST13 (an Ontario delivery)
    INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,total_cents,currency,requester_id) VALUES (100,'paid',1,'OLD-1','2026-01-10',100,'CAD',1);
    INSERT INTO invoice_lines (invoice_id,line_no,line_type,description,unit_price_cents,amount_cents,currency,gl_account_id,tax_code_id) VALUES
      (100,1,'goods','Fuel surcharge 10%',100,100,'CAD',5020,(SELECT id FROM tax_codes WHERE code='HST13')),
      (100,2,'goods','Linehaul freight',100,100,'CAD',5010,(SELECT id FROM tax_codes WHERE code='HST13'));
  `);
});

const cookie = (u: number) => ({ cookie: `session=${signSession(u)}` });
const process_ = async (inv: Partial<ExtractedInvoice> = {}, vendorId?: number) => {
  extractMock.mockResolvedValue({ status: "ok", invoice: { ...base, invoiceNumber: `INV-${++n}`, ...inv }, cached: false });
  const file = path.join(dir, `f${n}.pdf`);
  fs.writeFileSync(file, "%PDF-1.4 x");
  const id = Number(getDb().prepare("INSERT INTO invoices (status,invoice_number,invoice_date,total_cents,currency,requester_id,source_file) VALUES ('received','','',0,'CAD',1,?)").run(file).lastInsertRowid);
  await processRoute(new Request("http://x", { method: "POST", headers: cookie(CLERK) }), { params: Promise.resolve({ id: String(id) }) });
  if (vendorId) getDb().prepare("UPDATE invoices SET vendor_id = ? WHERE id = ?").run(vendorId, id);
  return id;
};
const lines = (id: number) =>
  getDb().prepare(
    `SELECT l.id, g.code AS gl, t.code AS tax, l.department_id AS dept, l.coding_source AS source, l.coding_reason AS reason, l.coding_needed AS needed
     FROM invoice_lines l LEFT JOIN gl_accounts g ON g.id = l.gl_account_id LEFT JOIN tax_codes t ON t.id = l.tax_code_id WHERE l.invoice_id = ? ORDER BY l.line_no`
  ).all(id) as { id: number; gl: string | null; tax: string | null; dept: number | null; source: string; reason: string; needed: number }[];
const patch = (user: number, id: number, lineId: number, body: unknown) =>
  codingRoute(new Request("http://x", { method: "PATCH", body: JSON.stringify(body), headers: cookie(user) }), { params: Promise.resolve({ id: String(id), lineId: String(lineId) }) });
const decide = (user: number, id: number, decision: string) =>
  decideRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ decision }), headers: cookie(user) }), { params: Promise.resolve({ id: String(id) }) });

test("each line gets its own account from history, with a stored reason", async () => {
  const id = await process_();
  const [fuel, freight] = lines(id);
  expect(fuel).toMatchObject({ gl: "5020", source: "history_description", needed: 0 });
  expect(freight).toMatchObject({ gl: "5010", source: "history_description", needed: 0 });
  expect(fuel.reason).toContain("similar description");
});

test("a line unlike any past line falls back to the vendor default account", async () => {
  const id = await process_({ lines: [{ description: "Pallet storage", quantity: "1", unitPriceCents: 10000, amountCents: 10000 }] });
  expect(lines(id)[0]).toMatchObject({ gl: "5010", source: "vendor_default", needed: 0 });
});

test("a new vendor with no default is flagged coding_needed and cannot be approved until a clerk sets it", async () => {
  getDb().exec("UPDATE vendors SET name = 'ACME Freight Inc', default_gl_account = NULL WHERE id = 1; DELETE FROM invoice_lines; DELETE FROM invoices;");
  const id = await process_();
  expect(lines(id).map((l) => l.needed)).toEqual([1, 1]);
  expect(JSON.parse((getDb().prepare("SELECT flags FROM invoices WHERE id = ?").get(id) as { flags: string }).flags).map((f: { code: string }) => f.code)).toContain("coding_needed");
  expect((await decide(APPROVER, id, "approved")).status).toBe(409);
  for (const l of lines(id)) expect((await patch(CLERK, id, l.id, { glAccount: "5010" })).status).toBe(200);
  expect(lines(id).map((l) => l.needed)).toEqual([0, 0]);
  expect((await decide(APPROVER, id, "approved")).status).toBe(200);
});

test("a rejection is allowed even while lines still need coding", async () => {
  getDb().exec("UPDATE vendors SET default_gl_account = NULL; DELETE FROM invoice_lines; DELETE FROM invoices;");
  const id = await process_();
  expect((await decide(APPROVER, id, "rejected")).status).toBe(200);
});

test("tax code comes from the delivery province, not from history", async () => {
  // History says HST13 (Ontario); this invoice ships to Alberta.
  const id = await process_({ shipToProvince: "AB", taxes: [{ label: "GST 5%", code: "GST", amountCents: 500 }], totalCents: 10500 });
  expect(lines(id).map((l) => l.tax)).toEqual(["GST5", "GST5"]);
  expect(lines(id)[0].reason).toContain("tax GST5 for AB");
});

test("department is the requester's by default and the PO's when the invoice has a PO", async () => {
  expect(lines(await process_()).map((l) => l.dept)).toEqual([1, 1]);
  getDb().exec("INSERT INTO purchase_orders (id,po_number,vendor_id,department_id,total_cents,currency) VALUES (1,'PO-1',1,2,100000,'CAD')");
  expect(lines(await process_({ poNumber: "PO-1" })).map((l) => l.dept)).toEqual([2, 2]);
});

test("setting coding changes the line, clears coding_needed and writes an audit row with before and after", async () => {
  getDb().exec("UPDATE vendors SET default_gl_account = NULL; DELETE FROM invoice_lines; DELETE FROM invoices;");
  const id = await process_();
  const line = lines(id)[0];
  const res = await patch(FINANCE, id, line.id, { glAccount: "6110", taxCode: "EXEMPT", departmentId: 2 });
  expect(res.status).toBe(200);
  expect(lines(id)[0]).toMatchObject({ gl: "6110", tax: "EXEMPT", dept: 2, source: "manual", needed: 0 });
  const audit = getDb().prepare("SELECT actor_id, before, after FROM audit_log WHERE action = 'invoice_line.coding_set' AND entity_id = ?").get(String(line.id)) as { actor_id: number; before: string; after: string };
  expect(audit.actor_id).toBe(FINANCE);
  expect(JSON.parse(audit.before)).toMatchObject({ glAccount: null, codingNeeded: true });
  expect(JSON.parse(audit.after)).toMatchObject({ glAccount: "6110", taxCode: "EXEMPT", departmentId: 2, codingNeeded: false });
});

test("only ap_clerk, finance_manager and controller_admin may set coding", async () => {
  const id = await process_();
  const line = lines(id)[0];
  for (const u of [EMP, APPROVER, 4]) expect((await patch(u, id, line.id, { glAccount: "6110" })).status).toBe(403);
  expect((await codingRoute(new Request("http://x", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ id: String(id), lineId: String(line.id) }) })).status).toBe(401);
  expect(lines(id)[0].gl).toBe("5020"); // untouched
});

test("bad input is refused: unknown account, empty change, wrong invoice, approved invoice", async () => {
  const id = await process_();
  const line = lines(id)[0];
  expect((await patch(CLERK, id, line.id, { glAccount: "9999" })).status).toBe(400);
  expect((await patch(CLERK, id, line.id, {})).status).toBe(400);
  expect((await patch(CLERK, id + 1, line.id, { glAccount: "6110" })).status).toBe(404);
  expect((await decide(APPROVER, id, "approved")).status).toBe(200);
  expect((await patch(CLERK, id, line.id, { glAccount: "6110" })).status).toBe(409);
});

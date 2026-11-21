import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as processRoute } from "@/app/api/invoices/[id]/process/route";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";

// No network: the extractor is replaced for every test.
vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";
const extractMock = vi.mocked(extractInvoice);

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const CLERK = 2;
const good: ExtractedInvoice = {
  vendorName: "Acme Freight Inc.",
  invoiceNumber: "INV-100",
  invoiceDate: "2026-11-01",
  dueDate: null,
  currency: "CAD",
  lines: [{ description: "Freight", quantity: "2", unitPriceCents: 5000, amountCents: 10000 }],
  taxes: [{ label: "HST 13%", code: "HST", amountCents: 1300 }],
  totalCents: 11300,
  poNumber: null,
  bankDetails: "001-12345-123456789",
  language: "en",
};
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-"));
  resetDbForTests();
  extractMock.mockReset();
  const db = getDb();
  db.exec(`
    INSERT INTO users (id,name,role,approval_limit_cents) VALUES
      (1,'Emp','employee',0),(2,'Clerk','ap_clerk',0),(3,'Appr','approver',100000000),(4,'Aud','auditor',0);
    UPDATE users SET province = 'ON';
    INSERT INTO departments (id,name,manager_user_id) VALUES (1,'Ops',3);
    UPDATE users SET department_id = 1, manager_id = 3 WHERE id = 1;
    INSERT INTO approval_policies (ext_id,rule_type,condition,required) VALUES
      ('P02','approval','Invoice total over $10,000 CAD','dept_manager > finance_manager'),
      ('P03','approval','Invoice total over $50,000 CAD','dept_manager > finance_manager > controller_admin'),
      ('P04','approval','Invoice total over $250,000 CAD','dept_manager > finance_manager > controller_admin > cfo');
    INSERT INTO vendors (id,name,bank_institution,bank_transit,bank_account) VALUES (1,'ACME Freight Inc','001','12345','123456789'),(2,'Other Co','001','99999','555555555');
    INSERT INTO vendor_bank_changes (vendor_id,changed_at,old_account_last4,new_account_last4,request_channel,verified_by_callback) VALUES (1,'2025-01-01','9999','6789','phone_callback_verified',1);
    INSERT INTO tax_codes (code,province,rate_bps,applies_to) VALUES ('HST13','ON',1300,'all'),('GST5','AB',500,'all'),('PST7_BC','BC',700,'goods'),('QST9975','QC',997.5,'all'),('EXEMPT',NULL,0,'all');
    -- one earlier, unrelated invoice: gives the vendor a coding history (line type, tax code) and a prior total
    INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,subtotal_cents,total_cents,currency,total_cad_cents,requester_id)
      VALUES (100,'paid',1,'OLD-1','2026-01-10',5000,5650,'CAD',5650,1);
    INSERT INTO invoice_lines (invoice_id,line_no,line_type,description,quantity,unit_price_cents,amount_cents,currency,gst_hst_code) VALUES (100,1,'services','Freight',1,5000,5000,'CAD','HST13');
  `);
});

const makeInvoice = (name = "a.pdf") => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "%PDF-1.4 x");
  return Number(
    getDb().prepare("INSERT INTO invoices (status,invoice_number,invoice_date,total_cents,currency,requester_id,source_file) VALUES ('received','','',0,'CAD',1,?)").run(file).lastInsertRowid
  );
};
const run = (id: number, user: number | null = CLERK) =>
  processRoute(new Request("http://x", { method: "POST", headers: user ? { cookie: `session=${signSession(user)}` } : {} }), {
    params: Promise.resolve({ id: String(id) }),
  });
const row = (id: number) => getDb().prepare("SELECT * FROM invoices WHERE id = ?").get(id) as Record<string, unknown>;
const codes = (id: number) => (JSON.parse(row(id).flags as string) as { code: string }[]).map((f) => f.code);
const actions = (id: number) =>
  (getDb().prepare("SELECT action FROM audit_log WHERE entity = 'invoice' AND entity_id = ? ORDER BY id").all(String(id)) as { action: string }[]).map((a) => a.action);
const ok = (invoice: Partial<ExtractedInvoice> = {}) =>
  extractMock.mockResolvedValue({ status: "ok", invoice: { ...good, ...invoice }, cached: false });

test("clean invoice is saved, routed to the approver and audited at every step", async () => {
  ok();
  const id = makeInvoice();
  const res = await run(id);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ invoiceId: id, status: "pending_approval", approverId: 3, flags: [] });
  expect(row(id)).toMatchObject({
    status: "pending_approval", vendor_id: 1, invoice_number: "INV-100", total_cents: 11300, currency: "CAD",
    subtotal_cents: 10000, gst_hst_cents: 1300, pst_qst_cents: 0, ship_to_province: "ON", total_cad_cents: 11300, fx_rate_to_cad_bps: 10000,
  });
  expect(getDb().prepare("SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?").get(id)).toEqual({ n: 1 });
  expect(actions(id)).toEqual(["invoice.extracted", "invoice.coding_suggestion", "invoice.routed", "invoice.checks", "invoice.status"]);
  expect(getDb().prepare("SELECT step_no, role, user_id, status FROM approval_steps WHERE invoice_id = ?").all(id)).toEqual([
    { step_no: 1, role: "dept_manager", user_id: 3, status: "pending" },
  ]);
});

test("same vendor and invoice number as an earlier invoice goes to needs_review with a duplicate flag", async () => {
  ok();
  const first = makeInvoice("a.pdf");
  await run(first);
  const second = makeInvoice("b.pdf");
  const body = await (await run(second)).json();
  expect(body.status).toBe("needs_review");
  expect(codes(second)).toContain("DUPLICATE_EXACT");
});

test("changed bank details go to needs_review with a bank flag", async () => {
  ok({ bankDetails: "001-12345-777777777" });
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("needs_review");
  expect(codes(id)).toContain("bank_differs_from_master");
});

test("any invoice from a vendor with a pending bank change is held, even when it shows the old account", async () => {
  getDb().prepare("INSERT INTO vendor_bank_changes (vendor_id,changed_at,old_account_last4,new_account_last4,status) VALUES (1,'2026-11-01','6789','7777','pending')").run();
  ok(); // invoice shows the account on file, not the new one
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("needs_review");
  expect(codes(id)).toContain("bank_change_unverified");
});

test("invoice with a still-pending new bank account is flagged as unverified", async () => {
  getDb().prepare("INSERT INTO vendor_bank_changes (vendor_id,changed_at,old_account_last4,new_account_last4,status) VALUES (1,'2026-11-01','6789','7777','pending')").run();
  ok({ bankDetails: "001-12345-777777777" });
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("needs_review");
  expect(codes(id)).toContain("bank_change_unverified");
});

test("extraction failure goes to needs_review and nothing is guessed", async () => {
  extractMock.mockResolvedValue({ status: "needs_review", reason: "model output was not valid JSON" });
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("needs_review");
  expect(codes(id)).toEqual(["extraction_failed"]);
  expect(row(id)).toMatchObject({ invoice_number: "", total_cents: 0, vendor_id: null });
  expect(actions(id)).toContain("invoice.extraction_failed");
});

test("an extractor that throws, or a missing file, also lands in needs_review", async () => {
  extractMock.mockRejectedValue(new Error("boom"));
  const a = makeInvoice("a.pdf");
  await run(a);
  expect(row(a).status).toBe("needs_review");
  const b = makeInvoice("b.pdf");
  fs.rmSync(path.join(dir, "b.pdf"));
  await run(b);
  expect(row(b).status).toBe("needs_review");
});

test("unknown vendor and a total that does not add up are flagged", async () => {
  ok({ vendorName: "Nobody Ltd", totalCents: 99999 });
  const id = makeInvoice();
  await run(id);
  expect(row(id).status).toBe("needs_review");
  expect(codes(id)).toEqual(expect.arrayContaining(["vendor_unmatched", "TOTAL_MISMATCH"]));
});

test("nobody can fill a step: needs_review with a routing flag and no stored chain", async () => {
  ok({
    lines: [{ description: "Big", quantity: "1", unitPriceCents: 2_000_000_000, amountCents: 2_000_000_000 }],
    taxes: [{ label: "HST 13%", code: "HST", amountCents: 260_000_000 }],
    totalCents: 2_260_000_000,
  });
  const id = makeInvoice(); // over every threshold, but this world has no finance manager
  await run(id);
  expect(getDb().prepare("SELECT COUNT(*) n FROM approval_steps").get()).toEqual({ n: 0 });
  expect(row(id).status).toBe("needs_review");
  expect(codes(id)).toContain("routing_failed");
});

test("roles: 401 without a session, 403 for others; 404 unknown; 409 on rerun", async () => {
  ok();
  const id = makeInvoice();
  expect((await run(id, null)).status).toBe(401);
  expect((await run(id, 1)).status).toBe(403);
  expect((await run(id, 4)).status).toBe(403);
  expect((await run(999)).status).toBe(404);
  expect((await run(id)).status).toBe(200);
  expect((await run(id)).status).toBe(409);
  expect(extractMock).toHaveBeenCalledTimes(1);
});

// ---- one test per check the pipeline wires in: the right code, and where the invoice ends up ----

const sql = (q: string) => getDb().exec(q);
const line = (description: string, amountCents: number, quantity = "1") => ({ description, quantity, unitPriceCents: Math.round(amountCents / Number(quantity)), amountCents });
// An invoice whose HST adds up, so only the thing under test is wrong.
const withHst = (lines: ReturnType<typeof line>[]): Partial<ExtractedInvoice> => {
  const sub = lines.reduce((n, l) => n + l.amountCents, 0);
  const tax = Math.round((sub * 13) / 100);
  return { lines, taxes: [{ label: "HST 13%", code: "HST", amountCents: tax }], totalCents: sub + tax };
};
// A credit note is the same shape with negative amounts; its HST is negative too.
const credit = (description: string, amountCents: number): Partial<ExtractedInvoice> => {
  const neg = withHst([line(description, -amountCents)]);
  return { ...neg, invoiceNumber: "CN-1" };
};

const errorCases: [name: string, setup: string, invoice: Partial<ExtractedInvoice>, code: string][] = [
  ["tax: HST charged where the requester's province needs GST", "UPDATE users SET province = 'AB' WHERE id = 1", {}, "WRONG_PROVINCE_CODE"],
  ["tax: amount differs from the rate", "", { taxes: [{ label: "HST 13%", code: "HST", amountCents: 1000 }], totalCents: 11000 }, "TAX_MISMATCH"],
  ["tax: a code that is not in tax_codes", "", { taxes: [{ label: "Magic tax", code: "MAGIC", amountCents: 1300 }] }, "UNKNOWN_TAX_CODE"],
  ["contract: expired", "INSERT INTO contracts (vendor_id,billing_type,currency,start_date,end_date,status) VALUES (1,'blanket','CAD','2025-01-01','2025-12-31','expired')", {}, "contract_expired"],
  ["contract: fixed fee differs", "INSERT INTO contracts (vendor_id,billing_type,monthly_fee_cents,currency,start_date,end_date) VALUES (1,'fixed_monthly',9000,'CAD','2026-01-01','2026-12-31')", {}, "contract_fee_mismatch"],
  ["contract: fuel surcharge over the cap", "INSERT INTO contracts (vendor_id,billing_type,fuel_surcharge_cap_pct,currency,start_date,end_date) VALUES (1,'rate_card',10,'CAD','2026-01-01','2026-12-31')",
    withHst([line("Freight", 10000), line("Fuel surcharge (20%)", 2000)]), "contract_fuel_surcharge_exceeded"],
  ["contract: hourly rate over the cap", "INSERT INTO contracts (vendor_id,billing_type,hourly_rate_cap_cents,currency,start_date,end_date) VALUES (1,'retainer',5000,'CAD','2026-01-01','2026-12-31')",
    withHst([line("Consulting hours", 12000, "2")]), "contract_hourly_rate_exceeded"],
  ["contract: month-to-date over the not-to-exceed", "INSERT INTO contracts (vendor_id,billing_type,not_to_exceed_monthly_cents,currency,start_date,end_date) VALUES (1,'blanket',9000,'CAD','2026-01-01','2026-12-31')", {}, "contract_nte_exceeded"],
  ["contract: currency pair with no rate", "INSERT INTO contracts (vendor_id,billing_type,monthly_fee_cents,currency,start_date,end_date) VALUES (1,'fixed_monthly',10000,'USD','2026-01-01','2026-12-31')", {}, "contract_fx_unknown"],
  ["po: vendor requires one and none is named", "UPDATE vendors SET requires_po = 1 WHERE id = 1", {}, "po_missing"],
  ["po: named but not on file", "", { poNumber: "PO-NOPE" }, "po_missing"],
  ["po: belongs to another vendor", "INSERT INTO purchase_orders (po_number,vendor_id,total_cents,currency) VALUES ('PO-1',2,50000,'CAD')", { poNumber: "PO-1" }, "po_wrong_vendor"],
  ["po: already fully billed", "INSERT INTO purchase_orders (id,po_number,vendor_id,total_cents,currency) VALUES (7,'PO-1',1,10000,'CAD'); UPDATE invoices SET po_id = 7 WHERE id = 100; UPDATE invoices SET subtotal_cents = 10000 WHERE id = 100", { poNumber: "PO-1" }, "po_fully_billed"],
  ["po: invoice above the PO total", "INSERT INTO purchase_orders (po_number,vendor_id,total_cents,currency) VALUES ('PO-1',1,5000,'CAD')", { poNumber: "PO-1" }, "po_total_exceeded"],
  ["credit note: names no invoice", "", credit("Goodwill credit", 3000), "CREDIT_NOTE_NO_ORIGINAL"],
  ["credit note: more than is left on the original", "", credit("Credit for OLD-1", 6000), "CREDIT_NOTE_EXCEEDS_ORIGINAL"],
  ["bank: account differs from the vendor master", "", { bankDetails: "001-12345-777777777" }, "bank_differs_from_master"],
  ["bank: an earlier change was never verified by callback", "UPDATE vendor_bank_changes SET verified_by_callback = 0, request_channel = 'email_request'", {}, "bank_change_unverified"],
  ["bank: text that is not institution, transit, account", "", { bankDetails: "12345 123456789" }, "bank_details_unparsed"],
  ["cross: a card charge for the same amount", "INSERT INTO card_transactions (ext_id,posted_date,merchant_descriptor,amount_cents,currency,amount_cad_cents) VALUES ('CT-1','2026-11-03','ACME FREIGHT INC','11300','CAD',11300)", {}, "cross_paid_card"],
  ["cross: a bank debit for the same amount", "INSERT INTO bank_statement (ext_id,posted_date,description,debit_cents) VALUES ('BT-1','2026-11-05','EFT PMT ACME FREIGHT INC  123456',11300)", {}, "cross_paid_bank"],
  ["cross: a payment to the vendor for the same amount", "INSERT INTO payments (invoice_id,vendor_id,method,scheduled_date,paid_at,amount_cents,currency,amount_cad_cents,status) VALUES (100,1,'EFT','2026-11-05',NULL,11300,'CAD',11300,'scheduled')", {}, "cross_paid_payment"],
  ["fx: USD invoice with no rate for its date", "", { currency: "USD" }, "fx_unknown"],
];
test.each(errorCases)("%s -> needs_review with the right code", async (_name, setup, invoice, code) => {
  sql(setup);
  ok(invoice);
  const id = makeInvoice();
  const body = await (await run(id)).json();
  expect(codes(id)).toContain(code);
  expect(body.status).toBe("needs_review");
  expect(row(id).status).toBe("needs_review");
});

test("split: pieces that each fit under the manager's limit but together do not are flagged, as a warning", async () => {
  sql("UPDATE users SET approval_limit_cents = 20000 WHERE id = 3; UPDATE invoices SET invoice_date = '2026-10-30', total_cad_cents = 11000 WHERE id = 100");
  ok();
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("pending_approval");
  expect(codes(id)).toEqual(["POSSIBLE_SPLIT_INVOICE"]);
});

test("a USD invoice with a rate is converted for limits and stored", async () => {
  sql("INSERT INTO fx_rates (date, usd_to_cad_bps) VALUES ('2026-11-01', 13709)");
  ok({ currency: "USD" });
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("pending_approval");
  expect(row(id)).toMatchObject({ currency: "USD", total_cents: 11300, fx_rate_to_cad_bps: 13709, total_cad_cents: 15491 });
});

test("a credit note that names an invoice with enough left goes on to approval", async () => {
  ok(credit("Credit for OLD-1", 3000));
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("pending_approval");
  expect(codes(id)).toEqual([]);
});

test("a bank debit that one of our own payments explains is not a second payment", async () => {
  sql(`INSERT INTO payments (invoice_id,vendor_id,method,paid_at,amount_cents,currency,amount_cad_cents) VALUES (100,2,'EFT','2026-11-05T10:00:00Z',11300,'CAD',11300);
       INSERT INTO bank_statement (ext_id,posted_date,description,debit_cents) VALUES ('BT-1','2026-11-05','EFT PMT ACME FREIGHT INC  123456',11300)`);
  ok();
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("pending_approval");
  expect(codes(id)).toEqual([]);
});

test("a vendor that charges no tax is judged by its earlier coding, not flagged for a missing tax row", async () => {
  sql("UPDATE invoice_lines SET gst_hst_code = 'EXEMPT' WHERE invoice_id = 100");
  ok({ taxes: [], totalCents: 10000 });
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("pending_approval");
  expect(codes(id)).toEqual([]);
});

test("missing due date is computed from the vendor's terms; an extracted due date is kept", async () => {
  getDb().prepare("UPDATE vendors SET payment_terms_days = 21 WHERE id = 1").run();
  ok({ dueDate: null });
  const a = makeInvoice();
  await run(a);
  expect(row(a).due_date).toBe("2026-11-22");
  ok({ invoiceNumber: "INV-101", dueDate: "2026-12-15" });
  const b = makeInvoice("b.pdf");
  await run(b);
  expect(row(b).due_date).toBe("2026-12-15");
});

test("unreadable early-pay terms add a visible warning, not an error and not a discount", async () => {
  getDb().prepare("UPDATE vendors SET early_pay_discount = 'pay fast, save' WHERE id = 1").run();
  ok();
  const id = makeInvoice();
  await run(id);
  expect(codes(id)).toContain("early_pay_terms_unparsed");
  expect(row(id).status).toBe("pending_approval");
});

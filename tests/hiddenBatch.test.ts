// A stand-in for the judges' hidden batch: 15 invoices that exist only in this test (names and numbers generated here,
// checked below to be absent from the dataset), uploaded as ONE batch through the real upload route. Only the extractor is mocked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice, ExtractResult } from "@/extract/extractInvoice";
import { POST as upload } from "@/app/api/invoices/upload/route";
import { getDb, resetDbForTests } from "@/server/db";
import { parseCsv } from "@/server/importDataset";
import { signSession } from "@/server/session";

vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";
const extractMock = vi.mocked(extractInvoice);

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// ---- generated names and numbers (a fixed seed keeps the test repeatable) ----
let seed = 20261121;
const rand = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
const pick = <T,>(xs: T[]) => xs[rand(xs.length)];
const SYL = ["bra", "vel", "quo", "tan", "mir", "zen", "lor", "pax", "dun", "fio", "gar", "hep", "jun", "kel", "nox", "wyl"];
const used = new Set<string>();
const unique = (make: () => string) => { let s = make(); while (used.has(s)) s = make(); used.add(s); return s; };
const vendorName = () => unique(() => { const w = pick(SYL) + pick(SYL) + pick(SYL); return `${w[0].toUpperCase()}${w.slice(1)} ${pick(["Supply", "Freight", "Works", "Partners", "Labs"])} ${pick(["Ltd.", "Inc.", "Corp."])}`; });
const invNumber = () => unique(() => `${pick(SYL).toUpperCase().slice(0, 2)}-${10000 + rand(89999)}`);
const digits = (n: number) => String(rand(10 ** n)).padStart(n, "0");

// ---- one vendor per case, each with an earlier paid invoice so the vendor has a coding history ----
type Prior = { number?: string; date?: string; subtotal?: number; total?: number; poId?: number };
type Seed = { name: string; bank: string; bankDetails: string };
function addVendor(opts: { status?: string; requiresPo?: boolean; currency?: "CAD" | "USD"; province?: string; code?: string; unverifiedChange?: boolean; prior?: Prior } = {}): Seed & { id: number; priorNumber: string } {
  const db = getDb();
  const name = vendorName();
  const [i, t, a] = [digits(3), digits(5), digits(9)];
  const id = Number(db.prepare(
    "INSERT INTO vendors (name, status, requires_po, currency, province_or_state, bank_institution, bank_transit, bank_account, payment_terms_days, onboarded_at, default_gl_account) VALUES (?,?,?,?,?,?,?,?,30,'2020-01-01','5010')"
  ).run(name, opts.status ?? "active", opts.requiresPo ? 1 : 0, opts.currency ?? "CAD", opts.province ?? "ON", i, t, a).lastInsertRowid);
  if (opts.unverifiedChange) db.prepare("INSERT INTO vendor_bank_changes (vendor_id, changed_at, request_channel, verified_by_callback, old_account_last4, new_account_last4) VALUES (?,?,?,?,?,?)").run(id, "2025-03-01", "email_request", 0, "1111", a.slice(-4));
  const p = opts.prior ?? {};
  const priorNumber = p.number ?? invNumber();
  const subtotal = p.subtotal ?? 5000 + rand(900) * 100;
  const total = p.total ?? Math.round(subtotal * 1.13);
  const cur = opts.currency ?? "CAD";
  const invId = Number(db.prepare(
    "INSERT INTO invoices (status, vendor_id, invoice_number, invoice_date, subtotal_cents, total_cents, currency, total_cad_cents, requester_id, po_id) VALUES ('paid',?,?,?,?,?,?,?,1,?)"
  ).run(id, priorNumber, p.date ?? "2026-01-12", subtotal, total, cur, total, p.poId ?? null).lastInsertRowid);
  db.prepare("INSERT INTO invoice_lines (invoice_id, line_no, line_type, description, quantity, unit_price_cents, amount_cents, currency, gst_hst_code) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(invId, 1, "services", "Services", 1, subtotal, subtotal, cur, opts.code ?? "HST13");
  return { id, name, bank: `${i}${t}${a}`, bankDetails: `${i}-${t}-${a}`, priorNumber };
}

// ---- builders for the model's answer ----
const hst = (c: number) => Math.round(c * 0.13);
type Over = Partial<ExtractedInvoice> & { subtotal?: number };
function bill(v: Seed, o: Over = {}): ExtractedInvoice {
  const subtotal = o.subtotal ?? (o.lines ? o.lines.reduce((n, l) => n + l.amountCents, 0) : 100_000);
  const taxes = o.taxes ?? [{ label: "HST 13%", code: "HST", amountCents: hst(subtotal) }];
  const lines = o.lines ?? [{ description: "Services", quantity: "1", unitPriceCents: subtotal, amountCents: subtotal }];
  return {
    vendorName: v.name, invoiceNumber: invNumber(), invoiceDate: "2026-10-14", dueDate: null, currency: "CAD", lines, taxes,
    totalCents: lines.reduce((s, l) => s + l.amountCents, 0) + taxes.reduce((s, t) => s + t.amountCents, 0),
    poNumber: null, bankDetails: v.bankDetails, language: "en", ...o,
  };
}

type Case = { name: string; answer: ExtractedInvoice | ExtractResult; codes: string[]; status: "pending_approval" | "needs_review" };
let cases: Case[];
let uploads: string;

beforeEach(() => {
  resetDbForTests();
  extractMock.mockReset();
  used.clear();
  uploads = fs.mkdtempSync(path.join(os.tmpdir(), "hidden-batch-"));
  process.env.UPLOAD_DIR = uploads;
  const db = getDb();
  db.exec(`
    INSERT INTO gl_accounts (id,code,name) VALUES (5010,'5010','Freight');
    INSERT INTO users (id,name,role,approval_limit_cents,province,department_id,manager_id,status,delegate_user_id) VALUES
      (1,'Emp','employee',0,'ON',NULL,NULL,'active',NULL),(3,'Mgr','approver',500000,'ON',NULL,NULL,'on_leave',7),
      (4,'Aud','auditor',0,'ON',NULL,NULL,'active',NULL),(5,'Fin','finance_manager',0,'ON',NULL,NULL,'active',NULL),(7,'Dele','approver',500000,'ON',NULL,NULL,'active',NULL);
    INSERT INTO departments (id,name,manager_user_id) VALUES (1,'Ops',3);
    UPDATE users SET department_id = 1, manager_id = 3 WHERE id = 1;
    INSERT INTO approval_policies (ext_id,rule_type,condition,required) VALUES
      ('P02','approval','Invoice total over $10,000 CAD','dept_manager > finance_manager'),
      ('P03','approval','Invoice total over $50,000 CAD','dept_manager > finance_manager > controller_admin'),
      ('P04','approval','Invoice total over $250,000 CAD','dept_manager > finance_manager > controller_admin > cfo');
    INSERT INTO tax_codes (code,province,rate_bps,applies_to) VALUES ('HST13','ON',1300,'all'),('GST5','AB',500,'all'),('QST9975','QC',997.5,'all'),('FOREIGN',NULL,0,'all');
    INSERT INTO fx_rates (date, usd_to_cad_bps) VALUES ('2026-10-14', 13500);
  `);

  const clean = addVendor();
  const french = addVendor({ province: "QC", code: "GST5" });
  const usdFee = addVendor({ currency: "USD", code: "FOREIGN" });
  const usdNoRate = addVendor({ currency: "USD", code: "FOREIGN" });
  const credited = addVendor({ prior: { subtotal: 100_000, total: 113_000 } });
  const missing = addVendor();
  const exact = addVendor({ prior: { number: "ab-" + (1000 + rand(8999)), date: "2026-09-01" } });
  const near = addVendor({ prior: { number: "ZQ-4821", date: "2026-10-05", subtotal: 100_000, total: 113_000 } });
  const arith = addVendor();
  const caps = addVendor({ prior: { date: "2026-10-02", subtotal: 250_000, total: 282_500 } });
  const po = addVendor();
  const hold = addVendor({ status: "on_hold", requiresPo: true });
  const bank = addVendor({ unverifiedChange: true });
  const twice = addVendor();
  const split = addVendor({ prior: { date: "2026-10-10", subtotal: 265_000, total: 299_450 } });

  db.prepare("INSERT INTO contracts (vendor_id,billing_type,monthly_fee_cents,currency,start_date,end_date,status) VALUES (?, 'fixed_monthly', 250000, 'USD', '2026-01-01','2026-12-31','active')").run(usdFee.id);
  db.prepare("INSERT INTO contracts (vendor_id,billing_type,hourly_rate_cap_cents,fuel_surcharge_cap_pct,not_to_exceed_monthly_cents,currency,start_date,end_date,status) VALUES (?, 'rate_card', 20000, 10, 300000, 'CAD', '2026-01-01','2026-12-31','active')").run(caps.id);
  const poNumber = `PO-${digits(6)}`;
  const poId = Number(db.prepare("INSERT INTO purchase_orders (po_number,vendor_id,total_cents,currency,status) VALUES (?,?,200000,'CAD','open')").run(poNumber, po.id).lastInsertRowid);
  db.prepare("INSERT INTO invoices (status,vendor_id,invoice_number,invoice_date,subtotal_cents,total_cents,currency,total_cad_cents,requester_id,po_id) VALUES ('paid',?,?,'2026-08-01',200000,226000,'CAD',226000,1,?)").run(po.id, invNumber(), poId);
  // Money for the "paid twice" case already left the account: one card charge and one bank debit, neither explained by a payment of ours.
  const twiceTotal = 123_456;
  db.prepare("INSERT INTO card_transactions (posted_date,merchant_descriptor,amount_cents,currency,amount_cad_cents) VALUES ('2026-10-10',?,?,'CAD',?)").run(twice.name.toUpperCase(), twiceTotal, twiceTotal);
  db.prepare("INSERT INTO bank_statement (posted_date,description,debit_cents) VALUES ('2026-10-12',?,?)").run(`EFT PMT ${twice.name.toUpperCase()} ${digits(6)}`, twiceTotal);

  const line = (description: string, qty: number, unit: number) => ({ description, quantity: String(qty), unitPriceCents: unit, amountCents: qty * unit });
  const fxl = [{ label: "", code: "", amountCents: 0 }].slice(1); // a USD vendor charges no Canadian tax
  cases = [
    { name: "clean", answer: bill(clean), codes: [], status: "pending_approval" },
    // QST worked out on the GST-inclusive amount: 100000 + 5000 GST, QST 9.975% of 105000 = 10474 instead of 9975
    { name: "french, Quebec, QST on GST", answer: bill(french, { language: "fr", shipToProvince: "QC", taxes: [{ label: "TPS 5%", code: "GST", amountCents: 5000 }, { label: "TVQ 9.975%", code: "QST", amountCents: 10_474 }] }), codes: ["QST_ON_GST_INCLUSIVE"], status: "needs_review" },
    { name: "usd monthly fee off", answer: bill(usdFee, { currency: "USD", taxes: fxl, subtotal: 260_000 }), codes: ["contract_fee_mismatch"], status: "needs_review" },
    { name: "usd with no rate for the day", answer: bill(usdNoRate, { currency: "USD", invoiceDate: "2026-10-17", taxes: fxl }), codes: ["fx_unknown"], status: "needs_review" },
    { name: "credit note", answer: bill(credited, { invoiceNumber: `CN-${credited.priorNumber}`, isCreditNote: true, lines: [line("Credit", 1, -50_000)], taxes: [{ label: "HST 13%", code: "HST", amountCents: -6_500 }] }), codes: [], status: "pending_approval" },
    { name: "missing field", answer: { status: "needs_review", reason: "invoiceNumber missing" }, codes: ["extraction_failed"], status: "needs_review" },
    { name: "exact duplicate", answer: bill(exact, { invoiceNumber: ` ${exact.priorNumber.toUpperCase()} `, subtotal: 90_000 }), codes: ["DUPLICATE_EXACT"], status: "needs_review" },
    { name: "near duplicate", answer: bill(near, { invoiceNumber: "ZQ-4822", subtotal: 100_000 }), codes: ["DUPLICATE_NEAR"], status: "pending_approval" },
    { name: "arithmetic", answer: bill(arith, { totalCents: 114_000 }), codes: ["TOTAL_MISMATCH"], status: "needs_review" },
    { name: "hourly, fuel and monthly cap", answer: bill(caps, { lines: [line("Consulting hours", 10, 25_000), line("Fuel surcharge", 1, 40_000)] }), codes: ["contract_hourly_rate_exceeded", "contract_fuel_surcharge_exceeded", "contract_nte_exceeded"], status: "needs_review" },
    { name: "PO overrun", answer: bill(po, { poNumber, subtotal: 250_000 }), codes: ["po_total_exceeded", "po_fully_billed"], status: "needs_review" },
    { name: "on-hold vendor, no PO", answer: bill(hold), codes: ["vendor_on_hold", "po_missing"], status: "needs_review" },
    { name: "unverified bank change", answer: bill(bank), codes: ["bank_change_unverified"], status: "needs_review" },
    { name: "already paid by card and bank", answer: bill(twice, { subtotal: 109_252, taxes: [{ label: "HST 13%", code: "HST", amountCents: 14_204 }] }), codes: ["cross_paid_card", "cross_paid_bank"], status: "needs_review" },
    { name: "split under the limit", answer: bill(split, { subtotal: 260_000 }), codes: ["POSSIBLE_SPLIT_INVOICE"], status: "pending_approval" },
  ];
});

afterEach(() => fs.rmSync(uploads, { recursive: true, force: true }));

test("the generated names and numbers are not in the dataset", () => {
  const read = (f: string) => parseCsv(fs.readFileSync(path.join("brim_ap_dataset", "data", f), "utf8"));
  const inDataset = new Set([...read("vendors.csv").map((r) => r.legal_name.toLowerCase()), ...read("invoices.csv").map((r) => r.vendor_invoice_number.toLowerCase())]);
  expect(used.size).toBeGreaterThan(15);
  for (const s of used) expect(inDataset.has(s.toLowerCase()), s).toBe(false);
});

test("15 invoices in one batch each get the expected flags, and the clean one gets none", async () => {
  expect(cases).toHaveLength(15);
  // The mock answers by the id written into each file's bytes, so the order the route processes them in does not matter.
  extractMock.mockImplementation(async (bytes) => {
    const c = cases[Number(/hb-(\d+)/.exec(Buffer.from(bytes).toString())![1])];
    return "status" in c.answer ? c.answer : { status: "ok", invoice: c.answer, cached: false };
  });
  const form = new FormData();
  cases.forEach((_, n) => form.append("file", new File([`%PDF-1.4 hb-${n}`], `case-${n}.pdf`, { type: "application/pdf" })));
  const res = await upload(new Request("http://x/api/invoices/upload", { method: "POST", headers: { cookie: `session=${signSession(1)}` }, body: form }));
  expect(res.status).toBe(200);
  const { results } = (await res.json()) as { results: { file: string; status: string; error: string | null; flags: { code: string }[] }[] };
  expect(results).toHaveLength(15);

  results.forEach((r, n) => {
    const want = cases[n];
    expect(r.error, want.name).toBeNull();
    expect([...new Set(r.flags.map((f) => f.code))].sort(), want.name).toEqual([...want.codes].sort());
    expect(r.status, want.name).toBe(want.status);
  });
  expect(results[0].flags).toEqual([]); // the clean invoice: no flags at all, not even a warning

  // The department manager is on leave, so a clean invoice is routed to the delegate (P08), never to the person on leave.
  const steps = getDb().prepare("SELECT DISTINCT user_id FROM approval_steps").all() as { user_id: number }[];
  expect(steps).toEqual([{ user_id: 7 }]);
});

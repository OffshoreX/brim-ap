import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { billingLines, crossFindings, pickContract, processInvoice, rateFor, toBillingContract, type ContractRow } from "./pipeline";
import { replayFindings } from "./replayHistory";
import { registerUpload } from "./upload";
import { checkArithmetic } from "./rules/arithmetic";
import { checkVendorBankRisk, type BankChangeRow } from "./rules/bank";
import { checkContractByBilling } from "./rules/contract";
import { findDuplicates } from "./rules/duplicates";
import { checkStoredFx, convertCents } from "./rules/fx";
import { checkPoMatch } from "./rules/po";
import { findSplitInvoices } from "./rules/split";
import { checkTax, type TaxCodeRate, type TaxLine } from "./rules/tax";
import type { Finding } from "./rules/types";
import { checkVendorStatus } from "./rules/vendorStatus";

// One finding on one invoice. id is the dataset's invoice id (AP-00012) or, for the incoming batch, the file name.
export type Hit = { code: string; id: string };

// The mess types the dataset README hints at. Each lists the finding codes of the existing rule that detects it.
export const CATEGORIES: { key: string; label: string; rule: string; codes: string[] }[] = [
  { key: "duplicate_exact", label: "Exact duplicate invoice", rule: "findDuplicates", codes: ["DUPLICATE_EXACT"] },
  { key: "duplicate_near", label: "Near duplicate invoice", rule: "findDuplicates", codes: ["DUPLICATE_NEAR"] },
  { key: "paid_twice", label: "Already paid (card, bank or another payment)", rule: "findCrossPayments", codes: ["cross_paid_card", "cross_paid_bank", "cross_paid_payment"] },
  { key: "arithmetic", label: "Arithmetic mismatch", rule: "checkArithmetic", codes: ["TOTAL_MISMATCH", "EMPTY_LINES", "NON_INTEGER_CENTS"] },
  { key: "wrong_tax", label: "Wrong tax for the delivery province", rule: "checkTax", codes: ["TAX_MISMATCH", "MISSING_TAX", "TAX_ON_EXEMPT", "WRONG_PROVINCE_CODE", "UNKNOWN_TAX_CODE", "UNKNOWN_PROVINCE", "PST_ON_SERVICES", "QST_ON_GST_INCLUSIVE"] },
  { key: "contract_fee", label: "Contract: monthly fee differs", rule: "checkContractByBilling", codes: ["contract_fee_mismatch"] },
  { key: "contract_hourly", label: "Contract: hourly rate above cap", rule: "checkContractByBilling", codes: ["contract_hourly_rate_exceeded"] },
  { key: "contract_fuel", label: "Contract: fuel surcharge above cap", rule: "checkContractByBilling", codes: ["contract_fuel_surcharge_exceeded"] },
  { key: "contract_nte", label: "Contract: not-to-exceed passed", rule: "checkContractByBilling", codes: ["contract_nte_exceeded"] },
  { key: "contract_expired", label: "Contract expired or not in force", rule: "checkContractByBilling", codes: ["contract_expired", "contract_missing"] },
  { key: "po_overrun", label: "PO overrun (over total, fully billed, wrong vendor)", rule: "checkPoMatch", codes: ["po_total_exceeded", "po_fully_billed", "po_wrong_vendor"] },
  { key: "po_missing", label: "No PO where the vendor needs one", rule: "checkPoMatch", codes: ["po_missing"] },
  { key: "vendor_status", label: "Vendor on hold or pending review", rule: "checkVendorStatus (new)", codes: ["vendor_on_hold", "vendor_pending_review"] },
  { key: "bank_unverified", label: "Bank change without callback verification", rule: "checkVendorBankRisk", codes: ["bank_change_unverified"] },
  { key: "split", label: "Split invoices under an approval limit", rule: "findSplitInvoices", codes: ["POSSIBLE_SPLIT_INVOICE"] },
  { key: "user_status", label: "Approver or releaser on leave or terminated", rule: "replay (compareApprovals, checkRelease)", codes: ["approved_while_on_leave", "approved_while_terminated", "released_while_on_leave", "released_while_terminated"] },
  { key: "fx", label: "FX rate or CAD total mismatch", rule: "checkStoredFx (new)", codes: ["fx_rate_mismatch", "fx_total_cad_mismatch", "fx_rate_missing", "fx_unknown", "contract_fx_unknown", "po_fx_unknown"] },
];

type Invoice = {
  id: number; ext_id: string; vendor_id: number; invoice_number: string; invoice_date: string; currency: string; subtotal_cents: number | null;
  gst_hst_cents: number | null; pst_qst_cents: number | null; total_cents: number; total_cad_cents: number | null; fx_rate_to_cad_bps: number | null;
  po_id: number | null; contract_id: number | null; ship_to_province: string | null; status: string; req_province: string | null; limit_cents: number | null;
};
type Line = { invoice_id: number; description: string; unit_price_cents: number; amount_cents: number; line_type: string | null; gst_hst_code: string | null; pst_qst_code: string | null };
type Vendor = { id: number; name: string; status: string | null; requires_po: number | null; bank_institution: string | null; bank_transit: string | null; bank_account: string | null; bank_details_updated_at: string | null };

const SPLIT_WINDOW_DAYS = 7; // same window the pipeline uses
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

// Runs the same rule functions the pipeline uses over every imported historical invoice, as if each had just arrived:
// "earlier" means invoices before it, so a pair of duplicates is counted once, on the later one.
export function historyHits(): { hits: Hit[]; invoices: number } {
  const db = getDb();
  const invoices = db
    .prepare(
      `SELECT i.id, i.ext_id, i.vendor_id, i.invoice_number, i.invoice_date, i.currency, i.subtotal_cents, i.gst_hst_cents, i.pst_qst_cents, i.total_cents, i.total_cad_cents,
       i.fx_rate_to_cad_bps, i.po_id, i.contract_id, i.ship_to_province, i.status, u.province AS req_province, m.approval_limit_cents AS limit_cents
       FROM invoices i LEFT JOIN users u ON u.id = i.requester_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = d.manager_user_id
       WHERE i.ext_id IS NOT NULL AND i.vendor_id IS NOT NULL ORDER BY i.invoice_date, i.id`
    )
    .all() as Invoice[];
  const linesBy = new Map<number, Line[]>();
  for (const l of db.prepare("SELECT invoice_id, description, unit_price_cents, amount_cents, line_type, gst_hst_code, pst_qst_code FROM invoice_lines ORDER BY invoice_id, line_no").all() as Line[])
    linesBy.set(l.invoice_id, [...(linesBy.get(l.invoice_id) ?? []), l]);
  const vendors = new Map((db.prepare("SELECT id, name, status, requires_po, bank_institution, bank_transit, bank_account, bank_details_updated_at FROM vendors").all() as Vendor[]).map((v) => [v.id, v]));
  const codes = (db.prepare("SELECT code, rate_bps, applies_to FROM tax_codes").all() as { code: string; rate_bps: number; applies_to: string | null }[]).map(
    (c): TaxCodeRate => ({ code: c.code, rateE5: Math.round(c.rate_bps * 10), appliesTo: c.applies_to === "goods" ? "goods" : "all" })
  );
  const changes = db.prepare("SELECT vendor_id, changed_at, request_channel, verified_by_callback, old_account_last4, new_account_last4 FROM vendor_bank_changes WHERE status = 'applied' ORDER BY changed_at").all() as
    { vendor_id: number; changed_at: string; request_channel: string | null; verified_by_callback: number | null; old_account_last4: string | null; new_account_last4: string | null }[];
  const pos = new Map((db.prepare("SELECT id, vendor_id, total_cents, currency FROM purchase_orders").all() as { id: number; vendor_id: number; total_cents: number; currency: string }[]).map((p) => [p.id, p]));
  const contractsById = new Map((db.prepare("SELECT * FROM contracts").all() as ContractRow[]).map((c) => [c.id, c]));
  const rates = rateFor(db);

  const hits: Hit[] = [];
  const earlier = new Map<number, Invoice[]>(); // per vendor, in arrival order
  for (const i of invoices) {
    const v = vendors.get(i.vendor_id)!;
    const before = earlier.get(i.vendor_id) ?? [];
    const add = (fs: Finding[]) => fs.forEach((f) => hits.push({ code: f.code, id: i.ext_id }));
    const lines = linesBy.get(i.id) ?? [];
    const credit = i.total_cents < 0;

    add(checkArithmetic(lines.map((l) => ({ totalCents: l.amount_cents })), [{ amountCents: i.gst_hst_cents ?? 0 }, { amountCents: i.pst_qst_cents ?? 0 }], i.total_cents));
    const taxLines: TaxLine[] = lines.map((l) => ({ amountCents: l.amount_cents, lineType: l.line_type === "services" ? "services" : "goods", gstHstCode: l.gst_hst_code || null, pstQstCode: l.pst_qst_code || null }));
    add(checkTax(taxLines, { gstHstCents: i.gst_hst_cents ?? 0, pstQstCents: i.pst_qst_cents ?? 0 }, i.ship_to_province ?? i.req_province ?? "(unknown)", codes));
    const key = (o: Invoice) => ({ id: String(o.id), vendorId: String(o.vendor_id), number: o.invoice_number, totalCents: o.total_cents, date: o.invoice_date, kind: (o.total_cents < 0 ? "credit_note" : "invoice") as "invoice" | "credit_note" });
    add(findDuplicates(key(i), before.filter((o) => o.invoice_number !== "").map(key)));
    add(checkVendorStatus(v.status));
    add(checkStoredFx({ currency: i.currency, totalCents: i.total_cents, totalCadCents: i.total_cad_cents, rateBps: i.fx_rate_to_cad_bps }, rates("USD", "CAD", i.invoice_date)?.rateBps));
    add(checkVendorBankRisk(
      { institution: v.bank_institution, transit: v.bank_transit, account: v.bank_account, date: i.invoice_date },
      { institution: v.bank_institution ?? "", transit: v.bank_transit ?? "", account: v.bank_account ?? "", updatedAt: v.bank_details_updated_at?.slice(0, 10) },
      changes.filter((c) => c.vendor_id === i.vendor_id && c.changed_at.slice(0, 10) <= i.invoice_date)
        .map((c): BankChangeRow => ({ changedAt: c.changed_at.slice(0, 10), channel: c.request_channel ?? "", verifiedByCallback: c.verified_by_callback === 1, oldLast4: c.old_account_last4 ?? "", newLast4: c.new_account_last4 ?? "" })),
      i.invoice_date
    ));
    if (credit) { earlier.set(i.vendor_id, [...before, i]); continue; } // credit notes are not checked against POs, contracts, limits or payments

    if (i.po_id || v.requires_po) {
      const po = i.po_id ? pos.get(i.po_id) : undefined;
      try {
        const billed = before.filter((o) => o.po_id === i.po_id && o.currency === po?.currency && o.status !== "rejected").reduce((s, o) => s + (o.subtotal_cents ?? 0), 0);
        const subtotal = convertCents(i.subtotal_cents ?? 0, i.currency, po?.currency ?? i.currency, rates(i.currency, po?.currency ?? i.currency, i.invoice_date));
        add(checkPoMatch({ vendorId: String(i.vendor_id), totalCents: subtotal }, po ? { vendorId: String(po.vendor_id), totalCents: po.total_cents, billedCents: billed } : null, 0));
      } catch { add([{ code: "po_fx_unknown", severity: "error", message: "Cannot convert to the PO currency" }]); }
    }
    const contract = i.contract_id ? contractsById.get(i.contract_id) : pickContract(db, i.vendor_id, i.invoice_date);
    if (contract) {
      const month = before.filter((o) => o.invoice_date.slice(0, 7) === i.invoice_date.slice(0, 7) && (o.subtotal_cents ?? 0) > 0 && o.status !== "rejected")
        .map((o) => ({ date: o.invoice_date, currency: o.currency, subtotalCents: o.subtotal_cents ?? 0 }));
      add(checkContractByBilling({ date: i.invoice_date, currency: i.currency, subtotalCents: i.subtotal_cents ?? 0, lines: billingLines(lines.map((l) => ({ description: l.description, unitPriceCents: l.unit_price_cents, amountCents: l.amount_cents }))) }, toBillingContract(contract), month, rates));
    }
    if (i.total_cad_cents !== null) {
      if (i.limit_cents) {
        const recent = before.filter((o) => o.total_cad_cents !== null && o.status !== "rejected" && days(o.invoice_date, i.invoice_date) <= SPLIT_WINDOW_DAYS)
          .map((o) => ({ id: String(o.id), vendorId: String(o.vendor_id), totalCents: o.total_cad_cents!, date: o.invoice_date }));
        add(findSplitInvoices({ id: String(i.id), vendorId: String(i.vendor_id), totalCents: i.total_cad_cents, date: i.invoice_date }, recent, i.limit_cents, SPLIT_WINDOW_DAYS));
      }
      add(crossFindings(db, v as Parameters<typeof crossFindings>[1], i.id, i.invoice_date, i.total_cad_cents));
    }
    earlier.set(i.vendor_id, [...before, i]);
  }
  // Approvals and releases by someone on leave or terminated come from the replay (T45), which already runs our routing and release rules.
  for (const f of replayFindings().findings) hits.push({ code: f.code, id: f.invoiceExtId });
  return { hits, invoices: invoices.length };
}

// Runs every file in a folder through the real pipeline (upload, extract, check), one at a time so earlier files count as history.
// The extractor answers only from its cache here: a file with no cached answer comes back needs_review and is listed, never guessed.
export async function incomingHits(dir: string): Promise<{ hits: Hit[]; files: number; notExtracted: string[]; noShipTo: number }> {
  const db = getDb();
  const clerk = db.prepare("SELECT id, role FROM users WHERE role = 'ap_clerk' ORDER BY id LIMIT 1").get() as Parameters<typeof registerUpload>[0];
  const files = fs.readdirSync(dir).filter((f) => /\.(pdf|png|jpe?g)$/i.test(f)).sort();
  const hits: Hit[] = [];
  const notExtracted: string[] = [];
  let noShipTo = 0; // extractions with no ship-to province: tax is then judged by the clerk's province, which inflates wrong-tax hits
  for (const file of files) {
    const { invoiceId } = registerUpload(clerk, fs.readFileSync(path.join(dir, file)));
    const res = await processInvoice(invoiceId, clerk.id);
    if (res.flags.some((f) => f.code === "extraction_failed")) notExtracted.push(file);
    else if ((db.prepare("SELECT json_extract(extraction_json, '$.shipToProvince') AS p FROM invoices WHERE id = ?").get(invoiceId) as { p: string | null }).p == null) noShipTo++;
    for (const f of res.flags) hits.push({ code: f.code, id: file });
  }
  return { hits, files: files.length, notExtracted, noShipTo };
}

export type MessRow = { key: string; label: string; rule: string; history: number; incoming: number; examples: string[]; codes: Record<string, number> }; // codes: findings per code, both sources
export type MessReport = {
  asOf: string; historicalInvoices: number; incomingFiles: number; incomingNotExtracted: string[]; incomingWithoutShipTo: number;
  rows: MessRow[]; other: Record<string, number>; // other: finding codes outside the categories above, with counts
};

// Counts distinct invoices per category, so one invoice with three tax findings is one hit, not three.
export function buildReport(history: Hit[], incoming: Hit[], meta: { asOf: string; historicalInvoices: number; incomingFiles: number; incomingNotExtracted: string[]; incomingWithoutShipTo: number }): MessReport {
  const ids = (hits: Hit[], codes: string[]) => [...new Set(hits.filter((h) => codes.includes(h.code)).map((h) => h.id))];
  const known = new Set(CATEGORIES.flatMap((c) => c.codes));
  const other: Record<string, number> = {};
  for (const h of [...history, ...incoming]) if (!known.has(h.code)) other[h.code] = (other[h.code] ?? 0) + 1;
  const rows = CATEGORIES.map((c) => {
    const h = ids(history, c.codes);
    const n = ids(incoming, c.codes);
    const byCode: Record<string, number> = {};
    for (const x of [...history, ...incoming]) if (c.codes.includes(x.code)) byCode[x.code] = (byCode[x.code] ?? 0) + 1;
    return { key: c.key, label: c.label, rule: c.rule, history: h.length, incoming: n.length, examples: [...h, ...n].slice(0, 3), codes: byCode };
  });
  return { ...meta, rows, other };
}

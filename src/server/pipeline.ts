import fs from "node:fs";
import path from "node:path";
import { extractInvoice, type ExtractedInvoice, type ExtractResult } from "../extract/extractInvoice"; // relative, not "@/": scripts/run-batch.mjs runs this file under plain Node
import { writeAudit } from "./audit";
import { createChain } from "./approvals";
import { getDb } from "./db";
import { transition } from "./invoiceStatus";
import { checkArithmetic } from "./rules/arithmetic";
import { checkVendorBankRisk, type BankChangeRow } from "./rules/bank";
import { suggestCoding } from "./rules/coding";
import { checkContractByBilling, type BillingContract, type BillingLine, type RateFor } from "./rules/contract";
import { checkCreditNote } from "./rules/creditnote";
import { CARD_WINDOW_DAYS, findCrossPayments, type BankTxn, type CardTxn, type PaymentRow } from "./rules/crosspay";
import { findDuplicates } from "./rules/duplicates";
import { convertCents } from "./rules/fx";
import { checkPoMatch } from "./rules/po";
import { findSplitInvoices } from "./rules/split";
import { checkTax, type TaxCodeRate, type TaxLine } from "./rules/tax";
import type { Finding } from "./rules/types";
import { matchVendor } from "./rules/vendorMatch";

// Response types live here, not in contracts.ts (lead-owned).
export type ProcessResult = {
  invoiceId: number;
  status: "needs_review" | "pending_approval";
  flags: Finding[];
  approverId: number | null;
};

// Carries the HTTP status so routes stay thin.
export class PipelineError extends Error {
  constructor(public status: 404 | 409, message: string) {
    super(message);
  }
}

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" };
const error = (code: string, message: string): Finding => ({ code, message, severity: "error" });
const warning = (code: string, message: string): Finding => ({ code, message, severity: "warning" });

// Policy knobs handed to the rules as arguments; the rules themselves contain no numbers.
const PO_TOLERANCE_BPS = 0; // P12: invoice within the PO balance, no extra slack
const SPLIT_WINDOW_DAYS = 7;

type Db = ReturnType<typeof getDb>;
type Vendor = {
  id: number; name: string; requires_po: number | null;
  bank_institution: string | null; bank_transit: string | null; bank_account: string | null; bank_details_updated_at: string | null;
};
type ContractRow = {
  id: number; billing_type: BillingContract["billingType"]; currency: string; start_date: string; end_date: string; status: string | null;
  monthly_fee_cents: number | null; hourly_rate_cap_cents: number | null; fuel_surcharge_cap_pct: number | null; not_to_exceed_monthly_cents: number | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Only USD->CAD exists in the data (fx_rates, one row per day); any other pair is refused, never guessed.
const rateFor = (db: Db): RateFor => (from, to, date) => {
  if (from !== "USD" || to !== "CAD") return undefined;
  const r = db.prepare("SELECT usd_to_cad_bps AS bps FROM fx_rates WHERE date = ?").get(date) as { bps: number } | undefined;
  return r && { from, to, rateBps: r.bps };
};

// The extractor gives a tax label and a code ("HST 13%", "HST"); tax_codes has "HST13". Match on letters and digits only.
function resolveTaxCode(t: { code: string; label: string }, codes: TaxCodeRate[]): string | null {
  const pct = (/(\d+(?:\.\d+)?)\s*%/.exec(t.label)?.[1] ?? "").replace(".", "");
  for (const text of [t.code, t.label]) {
    const n = alnum(text);
    if (!n) continue;
    const hit = codes.find((c) => alnum(c.code) === n) ?? codes.find((c) => alnum(c.code).startsWith(n + pct)) ?? codes.find((c) => alnum(c.code).startsWith(n));
    if (hit) return hit.code;
  }
  return null;
}

// Builds checkTax's inputs. The extractor reads no per-line codes, so every line carries the invoice's own tax codes;
// a vendor that charges no tax shows none, so its last coding (EXEMPT, FOREIGN) stands in. Province = where the requester works.
// ponytail: line type comes from the vendor's latest history line; a vendor mixing goods and services in BC needs per-line types.
function taxFindings(db: Db, x: ExtractedInvoice, vendorId: number, invoiceId: number, province: string | null) {
  const codes = (db.prepare("SELECT code, rate_bps, applies_to FROM tax_codes").all() as { code: string; rate_bps: number; applies_to: string | null }[]).map(
    (c): TaxCodeRate => ({ code: c.code, rateE5: Math.round(c.rate_bps * 10), appliesTo: c.applies_to === "goods" ? "goods" : "all" })
  );
  const charged = { gstHstCents: 0, pstQstCents: 0 };
  let gstCode: string | null = null;
  let pstCode: string | null = null;
  for (const t of x.taxes) {
    const known = resolveTaxCode(t, codes);
    const code = known ?? t.code; // an unknown code goes through so checkTax reports it
    if (/^(PST|QST)/i.test(known ?? "") || (!known && /PST|QST/i.test(t.code + t.label))) { charged.pstQstCents += t.amountCents; pstCode ??= code; }
    else { charged.gstHstCents += t.amountCents; gstCode ??= code; }
  }
  const last = db
    .prepare("SELECT l.line_type, l.gst_hst_code FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.vendor_id = ? AND i.id != ? AND l.line_type IS NOT NULL ORDER BY i.invoice_date DESC, l.id DESC LIMIT 1")
    .get(vendorId, invoiceId) as { line_type: "goods" | "services"; gst_hst_code: string | null } | undefined;
  if (!gstCode && last?.gst_hst_code && codes.find((c) => c.code === last.gst_hst_code)?.rateE5 === 0) gstCode = last.gst_hst_code;
  const lineType = last?.line_type ?? "goods";
  const lines: TaxLine[] = x.lines.map((l) => ({ amountCents: l.amountCents, lineType, gstHstCode: gstCode, pstQstCode: pstCode }));
  const findings: Finding[] = checkTax(lines, charged, province ?? "(unknown)", codes);
  if (!last) findings.push(warning("tax_line_type_assumed", "No earlier invoice from this vendor, so lines were treated as goods"));
  return { findings, lines, charged, lineType, gstCode, pstCode };
}

// The contract in force on the invoice date; else the latest one, so the rule reports it expired. A vendor with no contract has none to check.
function pickContract(db: Db, vendorId: number, date: string): ContractRow | null {
  const rows = db.prepare("SELECT * FROM contracts WHERE vendor_id = ? ORDER BY end_date DESC").all(vendorId) as ContractRow[];
  return rows.find((r) => r.status !== "expired" && r.start_date <= date && date <= r.end_date) ?? rows[0] ?? null;
}

function contractFindings(db: Db, c: ContractRow, x: ExtractedInvoice, vendorId: number, invoiceId: number, subtotalCents: number): Finding[] {
  const contract: BillingContract = {
    billingType: c.billing_type, currency: c.currency, startDate: c.start_date, endDate: c.end_date, status: c.status ?? undefined,
    monthlyFeeCents: c.monthly_fee_cents ?? undefined, hourlyRateCapCents: c.hourly_rate_cap_cents ?? undefined,
    fuelSurchargeCapBps: c.fuel_surcharge_cap_pct === null ? undefined : Math.round(c.fuel_surcharge_cap_pct * 100), // 12 (%) -> 1200
    notToExceedMonthlyCents: c.not_to_exceed_monthly_cents ?? undefined,
  };
  // What a line is comes from its description here; the rule never guesses.
  const lines: BillingLine[] = x.lines.map((l) => ({
    kind: /fuel/i.test(l.description) ? "fuel_surcharge" : /\bhours?\b|\bhrs?\b/i.test(l.description) ? "hourly" : "other",
    amountCents: l.amountCents, unitPriceCents: l.unitPriceCents,
  }));
  const month = db
    .prepare("SELECT invoice_date AS date, currency, subtotal_cents AS subtotalCents FROM invoices WHERE vendor_id = ? AND id != ? AND substr(invoice_date,1,7) = substr(?,1,7) AND subtotal_cents > 0 AND status != 'rejected'")
    .all(vendorId, invoiceId, x.invoiceDate) as { date: string; currency: string; subtotalCents: number }[];
  return checkContractByBilling({ date: x.invoiceDate, currency: x.currency, subtotalCents, lines }, contract, month, rateFor(db));
}

// PO amounts in the data are before tax, so the subtotal is what gets compared.
function poFindings(db: Db, po: { id: number; vendor_id: number; total_cents: number; currency: string } | undefined, x: ExtractedInvoice, vendorId: number, invoiceId: number, subtotalCents: number): Finding[] {
  if (!po) return checkPoMatch({ vendorId: String(vendorId), totalCents: subtotalCents }, null, PO_TOLERANCE_BPS);
  try {
    const inPoCurrency = convertCents(subtotalCents, x.currency, po.currency, rateFor(db)(x.currency, po.currency, x.invoiceDate));
    // ponytail: only invoices in the PO's own currency count as billed; mixed-currency billing on one PO is rare.
    const billed = (db.prepare("SELECT COALESCE(SUM(subtotal_cents),0) AS n FROM invoices WHERE po_id = ? AND id != ? AND currency = ? AND status NOT IN ('rejected','received')").get(po.id, invoiceId, po.currency) as { n: number }).n;
    return checkPoMatch({ vendorId: String(vendorId), totalCents: inPoCurrency }, { vendorId: String(po.vendor_id), totalCents: po.total_cents, billedCents: billed }, PO_TOLERANCE_BPS);
  } catch (e) {
    return [error("po_fx_unknown", e instanceof Error ? e.message : "Cannot convert currency")];
  }
}

// A credit note names the invoice it credits in its text; the longest invoice number of this vendor found there is that invoice.
function creditFindings(db: Db, x: ExtractedInvoice, vendorId: number, invoiceId: number): Finding[] {
  const text = x.lines.map((l) => l.description).join(" ").toLowerCase();
  const originals = (db.prepare("SELECT id, invoice_number, total_cents FROM invoices WHERE vendor_id = ? AND total_cents > 0 AND invoice_number != ''").all(vendorId) as { id: number; invoice_number: string; total_cents: number }[])
    .filter((o) => new RegExp(`(?<![a-z0-9])${o.invoice_number.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(text))
    .sort((a, b) => b.invoice_number.length - a.invoice_number.length);
  const orig = originals[0];
  // ponytail: earlier credits are found by their text mentioning the number; a real link column would be exact.
  const credited = orig
    ? (db.prepare("SELECT COALESCE(-SUM(total_cents),0) AS n FROM invoices WHERE vendor_id = ? AND id != ? AND total_cents < 0 AND status != 'rejected' AND instr(lower(extraction_json), ?) > 0").get(vendorId, invoiceId, orig.invoice_number.toLowerCase()) as { n: number }).n
    : 0;
  return checkCreditNote(
    { vendorId: String(vendorId), totalCents: x.totalCents, referencesInvoiceId: orig ? String(orig.id) : null },
    orig ? [{ id: String(orig.id), vendorId: String(vendorId), totalCents: orig.total_cents, creditedCents: credited }] : []
  );
}

// Only money that left outside our own records counts: a bank or card line that one of our payments explains is not a second payment.
// ponytail: "explains" = same CAD amount paid within 3 days; an unrelated payment that clashes would hide a real duplicate.
function crossFindings(db: Db, vendor: Vendor, invoiceId: number, date: string, cadCents: number): Finding[] {
  const unexplained = (amount: string, posted: string) =>
    `NOT EXISTS (SELECT 1 FROM payments p WHERE p.amount_cad_cents = ${amount} AND p.paid_at IS NOT NULL AND ABS(julianday(substr(p.paid_at,1,10)) - julianday(${posted})) <= 3)`;
  // The rule decides on name and date; these queries only narrow the rows to the same amount (card allows 1 cent, as the rule does).
  const card = db
    .prepare(`SELECT COALESCE(ext_id, CAST(id AS TEXT)) AS id, COALESCE(merchant_descriptor,'') AS merchant, amount_cad_cents AS amountCadCents, posted_date AS date FROM card_transactions WHERE amount_cad_cents BETWEEN ? AND ? AND ${unexplained("amount_cad_cents", "posted_date")}`)
    .all(cadCents - 1, cadCents + 1) as CardTxn[];
  const bank = db
    .prepare(`SELECT COALESCE(ext_id, CAST(id AS TEXT)) AS id, COALESCE(description,'') AS description, debit_cents AS debitCents, posted_date AS date FROM bank_statement WHERE debit_cents = ? AND ${unexplained("debit_cents", "posted_date")}`)
    .all(cadCents) as BankTxn[];
  // Monthly fees repeat at the same amount, so only payments close to this invoice's date count.
  const payments = db
    .prepare("SELECT COALESCE(ext_id, CAST(id AS TEXT)) AS id, CAST(invoice_id AS TEXT) AS invoiceId, CAST(vendor_id AS TEXT) AS vendorId, amount_cad_cents AS amountCents FROM payments WHERE vendor_id = ? AND amount_cad_cents = ? AND ABS(julianday(substr(COALESCE(paid_at, scheduled_date),1,10)) - julianday(?)) <= ?")
    .all(vendor.id, cadCents, date, CARD_WINDOW_DAYS) as PaymentRow[];
  return findCrossPayments({ id: String(invoiceId), vendorId: String(vendor.id), totalCents: cadCents, date }, { id: String(vendor.id), legalName: vendor.name }, card, bank, payments);
}

// Bank text like "003 92968 953389679" is institution, transit, account. A lone number is taken as the account.
function parseBank(text: string, v: Vendor) {
  const g = text.match(/\d+/g) ?? [];
  if (g.length === 3) return { institution: g[0], transit: g[1], account: g[2] };
  if (g.length === 1) return { institution: v.bank_institution ?? "", transit: v.bank_transit ?? "", account: g[0] };
  return null;
}

// Compares the invoice's account with the vendor master and reads the change history for risk (unverified, recent).
function bankFindings(db: Db, v: Vendor, text: string, invoiceDate: string): Finding[] {
  const bank = parseBank(text, v);
  if (!bank) return [error("bank_details_unparsed", "Could not read institution, transit and account from the invoice")];
  const changes = (db.prepare("SELECT changed_at, request_channel, verified_by_callback, old_account_last4, new_account_last4 FROM vendor_bank_changes WHERE vendor_id = ? AND status = 'applied' ORDER BY changed_at").all(v.id) as
    { changed_at: string; request_channel: string | null; verified_by_callback: number | null; old_account_last4: string | null; new_account_last4: string | null }[])
    .map((c): BankChangeRow => ({ changedAt: c.changed_at.slice(0, 10), channel: c.request_channel ?? "", verifiedByCallback: c.verified_by_callback === 1, oldLast4: c.old_account_last4 ?? "", newLast4: c.new_account_last4 ?? "" }));
  const out = checkVendorBankRisk(
    { ...bank, date: invoiceDate },
    { institution: v.bank_institution ?? "", transit: v.bank_transit ?? "", account: v.bank_account ?? "", updatedAt: v.bank_details_updated_at?.slice(0, 10) },
    changes,
    today()
  );
  // A request still waiting for its callback is not on file yet: say so, so a clerk knows why the account differs.
  const pending = db.prepare("SELECT 1 FROM vendor_bank_changes WHERE vendor_id = ? AND status = 'pending' AND new_account_last4 = ?").get(v.id, bank.account.slice(-4));
  if (pending) out.push(error("bank_change_unverified", "Vendor bank change not yet verified by callback"));
  return out;
}

// Never throws: an unreadable file or a crashing extractor is just another needs_review.
async function extract(file: string | null): Promise<ExtractResult> {
  try {
    if (!file) return { status: "needs_review", reason: "invoice has no stored file" };
    const bytes = fs.readFileSync(file);
    return await extractInvoice(bytes, MIME[path.extname(file).slice(1)] ?? "");
  } catch (e) {
    return { status: "needs_review", reason: e instanceof Error ? e.message : "extraction failed" };
  }
}

// Reads the stored file, extracts, checks, then moves the invoice to needs_review or pending_approval.
// ponytail: only 'received' invoices run; re-running a needs_review one needs a retry flow if we want it.
export async function processInvoice(invoiceId: number, actorId: number | null = null): Promise<ProcessResult> {
  const db = getDb();
  const first = db.prepare("SELECT status, source_file FROM invoices WHERE id = ?").get(invoiceId) as
    | { status: string; source_file: string | null }
    | undefined;
  if (!first) throw new PipelineError(404, "Invoice not found");
  if (first.status !== "received") throw new PipelineError(409, `Invoice is ${first.status}, not received`);

  // The slow model call happens outside the transaction; everything after it is one atomic step.
  const extracted = await extract(first.source_file);

  return db.transaction(() => {
    // Re-check: another request may have processed it while we waited on the model.
    const now = db.prepare("SELECT status FROM invoices WHERE id = ?").get(invoiceId) as { status: string };
    if (now.status !== "received") throw new PipelineError(409, `Invoice is ${now.status}, not received`);

    // Persists flags, audits them, moves the status. Errors send it to a human; warnings ride along.
    const finish = (flags: Finding[], approverId: number | null): ProcessResult => {
      const status = flags.some((f) => f.severity === "error") ? "needs_review" : "pending_approval";
      db.prepare("UPDATE invoices SET flags = ? WHERE id = ?").run(JSON.stringify(flags), invoiceId);
      writeAudit({ actorId, action: "invoice.checks", entity: "invoice", entityId: invoiceId, before: { flags: [] }, after: { flags } });
      transition(invoiceId, status, actorId);
      return { invoiceId, status, flags, approverId: status === "pending_approval" ? approverId : null };
    };

    if (extracted.status !== "ok") {
      writeAudit({ actorId, action: "invoice.extraction_failed", entity: "invoice", entityId: invoiceId, after: { reason: extracted.reason } });
      return finish([error("extraction_failed", extracted.reason)], null);
    }
    const x: ExtractedInvoice = extracted.invoice;

    // Vendor match (rules/vendorMatch.ts). The extractor does not return a tax number yet, so only the name is passed.
    const vendors = db
      .prepare("SELECT id, name, gst_hst_number AS taxNumber, requires_po, bank_institution, bank_transit, bank_account, bank_details_updated_at FROM vendors")
      .all() as (Vendor & { taxNumber: string | null })[];
    const match = matchVendor(x.vendorName, vendors);
    const vendor = match.status === "matched" ? vendors.find((v) => v.id === match.id)! : null;
    const vendorId = vendor?.id ?? null;
    const flags: Finding[] = [];
    if (match.status === "none") flags.push(error("vendor_unmatched", `No vendor named "${x.vendorName}"`));
    if (match.status === "ambiguous") flags.push(error("vendor_ambiguous", `${match.ids.length} vendors match "${x.vendorName}"`));
    // Matched, but only after ignoring formatting: say so, so a clerk can see which record was used.
    if (vendor && match.status === "matched" && match.by === "normalized_name") flags.push(warning("vendor_name_variant", `"${x.vendorName}" was matched to vendor "${vendor.name}"`));
    const po = x.poNumber
      ? (db.prepare("SELECT id, vendor_id, total_cents, currency FROM purchase_orders WHERE po_number = ?").get(x.poNumber) as
          | { id: number; vendor_id: number; total_cents: number; currency: string }
          | undefined)
      : undefined;

    // Amounts the checks and the stored row share. CAD is used only to compare against limits and other CAD records.
    const subtotalCents = sum(x.lines.map((l) => l.amountCents));
    const isCredit = x.totalCents < 0;
    const fx = rateFor(db)(x.currency, "CAD", x.invoiceDate);
    let totalCadCents: number | null = null;
    try {
      totalCadCents = convertCents(x.totalCents, x.currency, "CAD", fx);
    } catch (e) {
      flags.push(error("fx_unknown", e instanceof Error ? e.message : "Cannot convert currency"));
    }
    const ctx = db
      .prepare(
        `SELECT u.province, m.approval_limit_cents AS limitCents FROM invoices i LEFT JOIN users u ON u.id = i.requester_id
         LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = d.manager_user_id WHERE i.id = ?`
      )
      .get(invoiceId) as { province: string | null; limitCents: number | null };
    const contract = vendorId !== null && !isCredit ? pickContract(db, vendorId, x.invoiceDate) : null;
    const tax = vendorId !== null ? taxFindings(db, x, vendorId, invoiceId, ctx.province) : null;

    // Save what was read (lines replaced so a rerun never doubles them).
    db.prepare(
      `UPDATE invoices SET vendor_id=?, invoice_number=?, invoice_date=?, due_date=?, subtotal_cents=?, gst_hst_cents=?, pst_qst_cents=?, total_cents=?, currency=?,
       fx_rate_to_cad_bps=?, total_cad_cents=?, ship_to_province=?, po_id=?, contract_id=?, extraction_json=?, extracted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`
    ).run(
      vendorId, x.invoiceNumber, x.invoiceDate, x.dueDate, subtotalCents, tax?.charged.gstHstCents ?? null, tax?.charged.pstQstCents ?? null, x.totalCents, x.currency,
      x.currency === "CAD" ? 10_000 : fx?.rateBps ?? null, totalCadCents, ctx.province, po?.id ?? null, contract?.id ?? null, JSON.stringify(x), invoiceId
    );
    db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(invoiceId);
    const addLine = db.prepare(
      "INSERT INTO invoice_lines (invoice_id, line_no, line_type, description, quantity, unit_price_cents, amount_cents, currency, gst_hst_code, pst_qst_code) VALUES (?,?,?,?,?,?,?,?,?,?)"
    );
    // quantity column is INTEGER; fractional quantities are kept as-is in extraction_json.
    x.lines.forEach((l, i) =>
      addLine.run(invoiceId, i + 1, tax?.lineType ?? null, l.description, Math.round(Number(l.quantity)), l.unitPriceCents, l.amountCents, x.currency, tax?.gstCode ?? null, tax?.pstCode ?? null)
    );
    writeAudit({
      actorId, action: "invoice.extracted", entity: "invoice", entityId: invoiceId,
      after: { vendorId, invoiceNumber: x.invoiceNumber, invoiceDate: x.invoiceDate, totalCents: x.totalCents, currency: x.currency, poId: po?.id ?? null, contractId: contract?.id ?? null, lines: x.lines.length },
    });

    // Checks. Each is a plain function; this code only gathers their inputs from the DB.
    flags.push(...checkArithmetic(x.lines.map((l) => ({ totalCents: l.amountCents })), x.taxes, x.totalCents));
    if (vendor && vendorId !== null) {
      flags.push(...tax!.findings);
      const others = db
        .prepare("SELECT id, invoice_number, total_cents, invoice_date FROM invoices WHERE vendor_id = ? AND id != ? AND invoice_number != ''")
        .all(vendorId, invoiceId) as { id: number; invoice_number: string; total_cents: number; invoice_date: string }[];
      flags.push(
        ...findDuplicates(
          { id: String(invoiceId), vendorId: String(vendorId), number: x.invoiceNumber, totalCents: x.totalCents, date: x.invoiceDate, kind: isCredit ? "credit_note" : "invoice" },
          others.map((o) => ({ id: String(o.id), vendorId: String(vendorId), number: o.invoice_number, totalCents: o.total_cents, date: o.invoice_date, kind: o.total_cents < 0 ? "credit_note" : "invoice" }))
        )
      );
      if (x.bankDetails) flags.push(...bankFindings(db, vendor, x.bankDetails, x.invoiceDate));

      if (isCredit) flags.push(...creditFindings(db, x, vendorId, invoiceId));
      else {
        // A PO is checked when the invoice names one or the vendor must have one (P13); a contract when the vendor has one.
        if (x.poNumber || vendor.requires_po) flags.push(...poFindings(db, po, x, vendorId, invoiceId, subtotalCents));
        if (contract) flags.push(...contractFindings(db, contract, x, vendorId, invoiceId, subtotalCents));
        if (totalCadCents !== null) {
          // The limit is the department manager's own: pieces that each fit under it but together do not are a split.
          if (ctx.limitCents) {
            const recent = db
              .prepare("SELECT CAST(id AS TEXT) AS id, CAST(vendor_id AS TEXT) AS vendorId, total_cad_cents AS totalCents, invoice_date AS date FROM invoices WHERE vendor_id = ? AND id != ? AND total_cad_cents IS NOT NULL AND status != 'rejected' AND ABS(julianday(invoice_date) - julianday(?)) <= ?")
              .all(vendorId, invoiceId, x.invoiceDate, SPLIT_WINDOW_DAYS) as { id: string; vendorId: string; totalCents: number; date: string }[];
            flags.push(...findSplitInvoices({ id: String(invoiceId), vendorId: String(vendorId), totalCents: totalCadCents, date: x.invoiceDate }, recent, ctx.limitCents, SPLIT_WINDOW_DAYS));
          }
          flags.push(...crossFindings(db, vendor, invoiceId, x.invoiceDate, totalCadCents));
        }
      }

      // Coding is a suggestion from this vendor's past lines; it is applied to the lines and audited.
      const past = db
        .prepare(
          `SELECT g.code AS account, t.code AS tax FROM invoice_lines l
           JOIN invoices i ON i.id = l.invoice_id JOIN gl_accounts g ON g.id = l.gl_account_id JOIN tax_codes t ON t.id = l.tax_code_id
           WHERE i.vendor_id = ? AND i.id != ?`
        )
        .all(vendorId, invoiceId) as { account: string; tax: string }[];
      const coding = suggestCoding(String(vendorId), past.map((p) => ({ vendorId: String(vendorId), accountCode: p.account, taxCode: p.tax })));
      if (coding.status === "suggested") {
        db.prepare(
          "UPDATE invoice_lines SET gl_account_id = (SELECT id FROM gl_accounts WHERE code = ?), tax_code_id = (SELECT id FROM tax_codes WHERE code = ?) WHERE invoice_id = ?"
        ).run(coding.accountCode, coding.taxCode, invoiceId);
      }
      writeAudit({ actorId, action: "invoice.coding_suggestion", entity: "invoice", entityId: invoiceId, after: coding });
    }

    // Routing only matters if nothing needs a human first.
    if (flags.some((f) => f.severity === "error")) return finish(flags, null);
    // The chain is stored as pending steps; if nobody can fill a step, a human looks at it.
    try {
      const steps = createChain(invoiceId, actorId);
      return finish(flags, Number(steps[0].userId));
    } catch (e) {
      return finish([...flags, error("routing_failed", e instanceof Error ? e.message : "approval routing failed")], null);
    }
  })();
}

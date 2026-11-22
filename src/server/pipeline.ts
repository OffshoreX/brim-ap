import fs from "node:fs";
import path from "node:path";
import { extractInvoice, type ExtractedInvoice, type ExtractResult } from "../extract/extractInvoice"; // relative, not "@/": scripts/run-batch.mjs runs this file under plain Node
import { writeAudit } from "./audit";
import { createChain } from "./approvals";
import { getDb } from "./db";
import { transition } from "./invoiceStatus";
import { budgetAndAnomalyFlags } from "./budgetAnomaly";
import { extractionFailure, writeFindings, writeStep, type StepStatus } from "./processLog";
import { AS_OF } from "./replayHistory";
import { checkArithmetic } from "./rules/arithmetic";
import { checkVendorBankRisk, readInvoiceBank, type BankChangeRow } from "./rules/bank";
import { codeLine } from "./rules/coding";
import { checkContractByBilling, type BillingContract, type BillingLine, type RateFor } from "./rules/contract";
import { checkCreditNote } from "./rules/creditnote";
import { CARD_WINDOW_DAYS, findCrossPayments, type BankTxn, type CardTxn, type PaymentRow } from "./rules/crosspay";
import { findDuplicates } from "./rules/duplicates";
import { convertCents } from "./rules/fx";
import { checkPaymentTerms, dueDateFor, parseEarlyPayTerms } from "./rules/paymentTerms";
import { checkPoMatch } from "./rules/po";
import { findSplitInvoices } from "./rules/split";
import { checkTaxAtSupply, resolveSupply, SUPPLY_LABEL, type Resolved } from "./rules/placeOfSupply";
import { requiredTaxCodes, type TaxCodeRate, type TaxLine } from "./rules/tax";
import { checkVendorStatus } from "./rules/vendorStatus";
import type { Finding } from "./rules/types";
import { exactKey, matchVendor } from "./rules/vendorMatch";
import { cleanDeep, hasMixedScripts, lookalikes } from "./rules/unicode";

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

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const error = (code: string, message: string): Finding => ({ code, message, severity: "error" });
const warning = (code: string, message: string): Finding => ({ code, message, severity: "warning" });

// Policy knobs handed to the rules as arguments; the rules themselves contain no numbers.
const PO_TOLERANCE_BPS = 0; // P12: invoice within the PO balance, no extra slack
const SPLIT_WINDOW_DAYS = 7;

type Db = ReturnType<typeof getDb>;
type Vendor = {
  id: number; name: string; status: string | null; requires_po: number | null;
  bank_institution: string | null; bank_transit: string | null; bank_account: string | null; bank_details_updated_at: string | null;
  payment_terms_days: number | null; early_pay_discount: string | null; province_or_state: string | null;
};
export type ContractRow = {
  id: number; billing_type: BillingContract["billingType"]; currency: string; start_date: string; end_date: string; status: string | null;
  monthly_fee_cents: number | null; hourly_rate_cap_cents: number | null; fuel_surcharge_cap_pct: number | null; not_to_exceed_monthly_cents: number | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, ""); // tax ids are compared on digits only
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Only USD->CAD exists in the data (fx_rates, one row per day); any other pair is refused, never guessed.
export const rateFor = (db: Db): RateFor => (from, to, date) => {
  if (from !== "USD" || to !== "CAD") return undefined;
  const r = db.prepare("SELECT usd_to_cad_bps AS bps FROM fx_rates WHERE date = ?").get(date) as { bps: number } | undefined;
  return r && { from, to, rateBps: r.bps };
};

// The extractor gives a tax label and a code ("HST 13%", "HST"); tax_codes has "HST13". Match on letters and digits only.
function resolveTaxCode(t: { code: string; label: string }, codes: TaxCodeRate[]): string | null {
  const pct = (/(\d+(?:\.\d+)?)\s*%/.exec(t.label.slice(0, 100))?.[1] ?? "").replace(".", "");
  for (const text of [t.code, t.label]) {
    const n = alnum(text);
    if (!n) continue;
    const hit = codes.find((c) => alnum(c.code) === n) ?? codes.find((c) => alnum(c.code).startsWith(n + pct)) ?? codes.find((c) => alnum(c.code).startsWith(n));
    if (hit) return hit.code;
  }
  return null;
}

// Builds checkTax's inputs. The extractor reads no per-line codes, so every line carries the invoice's own tax codes;
// a vendor that charges no tax shows none, so its last coding (EXEMPT, FOREIGN) stands in. The province comes from rules/placeOfSupply.ts.
// ponytail: line type comes from the vendor's latest history line; a vendor mixing goods and services in BC needs per-line types.
function taxFindings(db: Db, x: ExtractedInvoice, vendorId: number, invoiceId: number, supply: Resolved) {
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
  const judged = checkTaxAtSupply(lines, charged, supply, codes);
  const findings: Finding[] = judged.findings;
  if (!last) findings.push(warning("tax_line_type_assumed", "No earlier invoice from this vendor, so lines were treated as goods"));
  return { findings, lines, charged, lineType, gstCode, pstCode, supply: judged.supply };
}

// The contract in force on the invoice date; else the latest one, so the rule reports it expired. A vendor with no contract has none to check.
export function pickContract(db: Db, vendorId: number, date: string): ContractRow | null {
  const rows = db.prepare("SELECT * FROM contracts WHERE vendor_id = ? ORDER BY end_date DESC").all(vendorId) as ContractRow[];
  return rows.find((r) => r.status !== "expired" && r.start_date <= date && date <= r.end_date) ?? rows[0] ?? null;
}

// contracts.csv row -> what the rule takes. fuel_surcharge_cap_pct is 12 (%), the rule wants basis points (1200).
export const toBillingContract = (c: ContractRow): BillingContract => ({
  billingType: c.billing_type, currency: c.currency, startDate: c.start_date, endDate: c.end_date, status: c.status ?? undefined,
  monthlyFeeCents: c.monthly_fee_cents ?? undefined, hourlyRateCapCents: c.hourly_rate_cap_cents ?? undefined,
  fuelSurchargeCapBps: c.fuel_surcharge_cap_pct === null ? undefined : Math.round(c.fuel_surcharge_cap_pct * 100),
  notToExceedMonthlyCents: c.not_to_exceed_monthly_cents ?? undefined,
});

// What a line is comes from its description here; the rule never guesses.
// A law firm bills "Legal services - <matter>" as hours x rate with no word 'hours', so that wording counts as hourly too.
export const billingLines = (lines: { description: string; amountCents: number; unitPriceCents: number }[]): BillingLine[] =>
  lines.map((l) => ({
    kind: /fuel/i.test(l.description) ? "fuel_surcharge" : /\bhours?\b|\bhrs?\b|\blegal services\b/i.test(l.description) ? "hourly" : "other",
    amountCents: l.amountCents, unitPriceCents: l.unitPriceCents,
  }));

function contractFindings(db: Db, c: ContractRow, x: ExtractedInvoice, vendorId: number, invoiceId: number, subtotalCents: number): Finding[] {
  const month = db
    .prepare("SELECT invoice_date AS date, currency, subtotal_cents AS subtotalCents FROM invoices WHERE vendor_id = ? AND id != ? AND substr(invoice_date,1,7) = substr(?,1,7) AND subtotal_cents > 0 AND status != 'rejected'")
    .all(vendorId, invoiceId, x.invoiceDate) as { date: string; currency: string; subtotalCents: number }[];
  return checkContractByBilling({ date: x.invoiceDate, currency: x.currency, subtotalCents, lines: billingLines(x.lines) }, toBillingContract(c), month, rateFor(db));
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

// A credit note points at the invoice it credits by its own number ("CN-1234" credits invoice "1234"), else by naming
// that invoice in its text. The longest invoice number of this vendor found there is the original.
// No original found: a warning only, there is nothing to check the amount against.
function creditFindings(db: Db, x: ExtractedInvoice, vendorId: number, invoiceId: number): { findings: Finding[]; originalId: number | null } {
  const text = x.lines.map((l) => l.description).join(" ").slice(0, 20_000).toLowerCase(); // capped: it is matched against every invoice number
  const suffix = /^CN-(.+)$/i.exec(x.invoiceNumber.trim())?.[1].trim().toLowerCase();
  const all = db.prepare("SELECT id, invoice_number, total_cents FROM invoices WHERE vendor_id = ? AND total_cents > 0 AND invoice_number != ''").all(vendorId) as { id: number; invoice_number: string; total_cents: number }[];
  const orig =
    all.find((o) => o.invoice_number.trim().toLowerCase() === suffix) ??
    all
      .filter((o) => new RegExp(`(?<![a-z0-9])${o.invoice_number.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(text))
      .sort((a, b) => b.invoice_number.length - a.invoice_number.length)[0];
  if (!orig) return { findings: [warning("credit_note_unmatched", `Credit note ${x.invoiceNumber} does not match an earlier invoice of this vendor`)], originalId: null };
  // ponytail: earlier credits are found by their text mentioning the number; a real link column would be exact.
  const credited = (db.prepare("SELECT COALESCE(-SUM(total_cents),0) AS n FROM invoices WHERE vendor_id = ? AND id != ? AND total_cents < 0 AND status != 'rejected' AND instr(lower(extraction_json), ?) > 0").get(vendorId, invoiceId, orig.invoice_number.toLowerCase()) as { n: number }).n;
  return {
    findings: checkCreditNote(
      { vendorId: String(vendorId), totalCents: x.totalCents, referencesInvoiceId: String(orig.id) },
      [{ id: String(orig.id), vendorId: String(vendorId), totalCents: orig.total_cents, creditedCents: credited }]
    ),
    originalId: orig.id,
  };
}

// Only money that left outside our own records counts: a bank or card line that one of our payments explains is not a second payment.
// ponytail: "explains" = same CAD amount paid within 3 days; an unrelated payment that clashes would hide a real duplicate.
export function crossFindings(db: Db, vendor: Vendor, invoiceId: number, date: string, cadCents: number): Finding[] {
  // Columns are table-qualified: unqualified, `amount_cad_cents` would bind to payments.amount_cad_cents inside the subquery and match every payment.
  const unexplained = (amount: string, posted: string) =>
    `NOT EXISTS (SELECT 1 FROM payments p WHERE p.amount_cad_cents = ${amount} AND p.paid_at IS NOT NULL AND ABS(julianday(substr(p.paid_at,1,10)) - julianday(${posted})) <= 3)`;
  // The rule decides on name and date; these queries only narrow the rows to the same amount (card allows 1 cent, as the rule does).
  const card = db
    .prepare(`SELECT COALESCE(ext_id, CAST(id AS TEXT)) AS id, COALESCE(merchant_descriptor,'') AS merchant, amount_cad_cents AS amountCadCents, posted_date AS date FROM card_transactions WHERE amount_cad_cents BETWEEN ? AND ? AND ${unexplained("card_transactions.amount_cad_cents", "card_transactions.posted_date")}`)
    .all(cadCents - 1, cadCents + 1) as CardTxn[];
  const bank = db
    .prepare(`SELECT COALESCE(ext_id, CAST(id AS TEXT)) AS id, COALESCE(description,'') AS description, debit_cents AS debitCents, posted_date AS date FROM bank_statement WHERE debit_cents = ? AND ${unexplained("bank_statement.debit_cents", "bank_statement.posted_date")}`)
    .all(cadCents) as BankTxn[];
  // Monthly fees repeat at the same amount, so only payments close to this invoice's date count.
  const payments = db
    .prepare("SELECT COALESCE(ext_id, CAST(id AS TEXT)) AS id, CAST(invoice_id AS TEXT) AS invoiceId, CAST(vendor_id AS TEXT) AS vendorId, amount_cad_cents AS amountCents FROM payments WHERE vendor_id = ? AND amount_cad_cents = ? AND ABS(julianday(substr(COALESCE(paid_at, scheduled_date),1,10)) - julianday(?)) <= ?")
    .all(vendor.id, cadCents, date, CARD_WINDOW_DAYS) as PaymentRow[];
  return findCrossPayments({ id: String(invoiceId), vendorId: String(vendor.id), totalCents: cadCents, date }, { id: String(vendor.id), legalName: vendor.name }, card, bank, payments);
}

// Compares the invoice's account with the vendor master and reads the change history for risk (unverified, recent).
function bankFindings(db: Db, v: Vendor, x: ExtractedInvoice): Finding[] {
  const read = readInvoiceBank(x);
  if (read.kind === "none") return [];
  if (read.kind === "unreadable") return [error("bank_details_unparsed", "Could not read institution, transit and account from the invoice")];
  const changes = (db.prepare("SELECT changed_at, request_channel, verified_by_callback, old_account_last4, new_account_last4 FROM vendor_bank_changes WHERE vendor_id = ? AND status = 'applied' ORDER BY changed_at").all(v.id) as
    { changed_at: string; request_channel: string | null; verified_by_callback: number | null; old_account_last4: string | null; new_account_last4: string | null }[])
    .map((c): BankChangeRow => ({ changedAt: c.changed_at.slice(0, 10), channel: c.request_channel ?? "", verifiedByCallback: c.verified_by_callback === 1, oldLast4: c.old_account_last4 ?? "", newLast4: c.new_account_last4 ?? "" }));
  return checkVendorBankRisk(
    { ...read.bank, date: x.invoiceDate },
    { institution: v.bank_institution ?? "", transit: v.bank_transit ?? "", account: v.bank_account ?? "", updatedAt: v.bank_details_updated_at?.slice(0, 10) },
    changes,
    today()
  );
}

// Never throws: an unreadable file or a crashing extractor is just another needs_review.
async function extract(file: string | null): Promise<ExtractResult> {
  try {
    if (!file) return { status: "needs_review", reason: "invoice has no stored file" };
    const bytes = fs.readFileSync(file);
    // EXTRACT_CACHE_DIR lets scripts/mess-report.mjs read cached answers from elsewhere; unset means the default cache.
    return await extractInvoice(bytes, MIME[path.extname(file).slice(1)] ?? "", { cacheDir: process.env.EXTRACT_CACHE_DIR || undefined });
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
  const extractStart = performance.now();
  const extracted = await extract(first.source_file);
  const extractMs = performance.now() - extractStart;

  return db.transaction(() => {
    // Re-check: another request may have processed it while we waited on the model.
    const now = db.prepare("SELECT status FROM invoices WHERE id = ?").get(invoiceId) as { status: string };
    if (now.status !== "received") throw new PipelineError(409, `Invoice is ${now.status}, not received`);

    // Processing log (T71): one row per step. These only write; no rule reads them back, and a failed write is swallowed (processLog.ts).
    const since = (start: number) => performance.now() - start;
    const step = (name: string, status: StepStatus, detail: string, ms = 0) => writeStep(db, invoiceId, name, status, detail, ms);
    const stepFlags = (name: string, found: Finding[], okDetail: string, ms: number) => writeFindings(db, invoiceId, name, found, okDetail, ms);
    const skipAll = (names: string[], why: string) => names.forEach((n) => step(n, "skipped", why));
    let routingLogged = false;

    // Persists flags, audits them, moves the status. Errors send it to a human; warnings ride along.
    const finish = (flags: Finding[], approverId: number | null): ProcessResult => {
      const status = flags.some((f) => f.severity === "error") ? "needs_review" : "pending_approval";
      if (status === "needs_review" && !routingLogged) step("approval_routing", "skipped", "Not routed to an approver: the invoice needs review first");
      db.prepare("UPDATE invoices SET flags = ? WHERE id = ?").run(JSON.stringify(flags), invoiceId);
      writeAudit({ actorId, action: "invoice.checks", entity: "invoice", entityId: invoiceId, before: { flags: [] }, after: { flags } });
      transition(invoiceId, status, actorId);
      return { invoiceId, status, flags, approverId: status === "pending_approval" ? approverId : null };
    };

    if (extracted.status !== "ok") {
      const plain = extractionFailure(extracted.reason); // the raw reason is logged server-side only
      step("extract", "failed", plain, extractMs);
      writeAudit({ actorId, action: "invoice.extraction_failed", entity: "invoice", entityId: invoiceId, after: { reason: plain } });
      return finish([error("extraction_failed", plain)], null);
    }
    const x: ExtractedInvoice = cleanDeep(extracted.invoice); // bidi controls removed from everything the UI will show
    step(
      "extract", x.notes ? "flagged" : "ok",
      `${extracted.cached ? "Read the saved answer for this file (no model call)" : "Called the model"}; schema validation passed${x.notes ? "; the document contained instructions, which were ignored" : ""}`,
      extractMs
    );

    // Vendor match (rules/vendorMatch.ts). The name decides first, so a tax id that disagrees with the named vendor is caught, not trusted.
    // Only when the name finds no one is the tax id (digits only) used to pick the vendor.
    const vendorStart = performance.now();
    const vendors = db
      .prepare("SELECT id, name, status, gst_hst_number AS taxNumber, requires_po, bank_institution, bank_transit, bank_account, bank_details_updated_at, payment_terms_days, early_pay_discount, province_or_state FROM vendors")
      .all() as (Vendor & { taxNumber: string | null })[];
    const taxDigits = digitsOf(x.vendorTaxId);
    let match = matchVendor(x.vendorName, vendors);
    if (match.status !== "matched" && taxDigits) {
      const byTax = matchVendor(x.vendorName, vendors.map((v) => ({ ...v, taxNumber: digitsOf(v.taxNumber) })), taxDigits);
      if (byTax.status === "matched") match = byTax;
    }
    const vendor = match.status === "matched" ? vendors.find((v) => v.id === match.id)! : null;
    const vendorId = vendor?.id ?? null;
    const flags: Finding[] = [];
    // Text inside the document is data. It is shown to the clerk and nothing in it is acted on.
    if (x.notes) flags.push(warning("document_contains_instructions", `The document contains an instruction, ignored: "${x.notes.slice(0, 300)}"`));
    const vendorFlagsFrom = flags.length;
    // A vendor name that mixes alphabets, or reads like a vendor on file without being spelled like it, is how a fake sender is dressed up.
    if (hasMixedScripts(x.vendorName)) flags.push(warning("vendor_name_mixed_scripts", `The vendor name "${x.vendorName}" mixes alphabets (for example Latin and Cyrillic letters)`));
    for (const twin of lookalikes(x.vendorName, vendors, exactKey).slice(0, 3))
      flags.push(warning("vendor_lookalike", `The vendor name "${x.vendorName}" looks like "${twin.name}" but is spelled differently`));
    if (vendor && match.status === "matched" && match.by === "tax_number")
      flags.push(warning("vendor_matched_by_tax_id", `No vendor is named "${x.vendorName}"; matched to "${vendor.name}" by tax id ${x.vendorTaxId}`));
    const vendorTax = digitsOf(vendor?.taxNumber);
    if (vendor && taxDigits && vendorTax && taxDigits !== vendorTax)
      flags.push(error("vendor_taxid_mismatch", `Tax id ${x.vendorTaxId} on the invoice differs from the one on file for "${vendor.name}"`));
    if (vendor) flags.push(...checkVendorStatus(vendor.status));
    if (match.status === "none") flags.push(error("vendor_unmatched", `No vendor named "${x.vendorName}"`));
    if (match.status === "ambiguous") flags.push(error("vendor_ambiguous", `${match.ids.length} vendors match "${x.vendorName}"`));
    // Matched, but only after ignoring formatting: say so, so a clerk can see which record was used.
    if (vendor && match.status === "matched" && match.by === "normalized_name") flags.push(warning("vendor_name_variant", `"${x.vendorName}" was matched to vendor "${vendor.name}"`));
    stepFlags("vendor_match", flags.slice(vendorFlagsFrom), vendor ? `Matched vendor ${vendor.name} by name` : "Matched a vendor", since(vendorStart));
    const po = x.poNumber
      ? (db.prepare("SELECT id, vendor_id, department_id, requester_user_id, total_cents, currency FROM purchase_orders WHERE po_number = ?").get(x.poNumber) as
          | { id: number; vendor_id: number; department_id: number | null; requester_user_id: number | null; total_cents: number; currency: string }
          | undefined)
      : undefined;

    // Terms we cannot read mean no discount, and a clerk is told why. A missing due date is worked out from the vendor's terms.
    const termsStart = performance.now();
    const termsFlagsFrom = flags.length;
    const terms = parseEarlyPayTerms(vendor?.early_pay_discount);
    if (terms.kind === "unparsed") flags.push(warning("early_pay_terms_unparsed", terms.note));
    // The vendor's terms win over the invoice's text: when they differ the due date comes from the vendor record too.
    const termsFlags = vendor ? checkPaymentTerms(x.paymentTerms, vendor.payment_terms_days) : [];
    flags.push(...termsFlags);
    const dueDate = (termsFlags.length === 0 ? x.dueDate : null) ?? (vendor ? dueDateFor(x.invoiceDate, vendor.payment_terms_days) : null);
    stepFlags("payment_terms", flags.slice(termsFlagsFrom), "Payment terms and due date agree with the vendor record", since(termsStart));

    // Amounts the checks and the stored row share. CAD is used only to compare against limits and other CAD records.
    const subtotalCents = sum(x.lines.map((l) => l.amountCents));
    const isCredit = x.isCreditNote === true || x.totalCents < 0;
    const fxStart = performance.now();
    const fxFlagsFrom = flags.length;
    const fx = rateFor(db)(x.currency, "CAD", x.invoiceDate);
    let totalCadCents: number | null = null;
    try {
      totalCadCents = convertCents(x.totalCents, x.currency, "CAD", fx);
    } catch (e) {
      flags.push(error("fx_unknown", e instanceof Error ? e.message : "Cannot convert currency"));
    }
    stepFlags("currency_conversion", flags.slice(fxFlagsFrom), x.currency === "CAD" ? "The invoice is in CAD, no conversion needed" : `Converted ${x.currency} to CAD at the stored daily rate`, since(fxStart));
    const ctx = db
      .prepare(
        `SELECT u.province, u.role, m.approval_limit_cents AS limitCents FROM invoices i LEFT JOIN users u ON u.id = i.requester_id
         LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = d.manager_user_id WHERE i.id = ?`
      )
      .get(invoiceId) as { province: string | null; role: string | null; limitCents: number | null };
    // Tax is judged by where the goods go. When the invoice does not say, the place of supply is guessed in a fixed order (rules/placeOfSupply.ts).
    // An uploading AP clerk is data entry, not the requester, so their province counts only as the last resort.
    const userProvince = (id: number | null | undefined) => (id ? (db.prepare("SELECT province FROM users WHERE id = ?").get(id) as { province: string | null } | undefined)?.province ?? null : null);
    const clerkUploaded = ctx.role === "ap_clerk";
    const supply = resolveSupply({ printed: x.shipToProvince, poRequester: userProvince(po?.requester_user_id), requester: clerkUploaded ? null : ctx.province, vendor: vendor?.province_or_state, clerk: clerkUploaded ? ctx.province : null });
    const contract = vendorId !== null && !isCredit ? pickContract(db, vendorId, x.invoiceDate) : null;
    const taxStart = performance.now();
    const tax = vendorId !== null ? taxFindings(db, x, vendorId, invoiceId, supply) : null;
    const taxMs = since(taxStart);
    const used = tax ? tax.supply : supply.chosen; // the province the tax was finally judged by, and where it came from
    const province = used?.province ?? null;

    // Save what was read (lines replaced so a rerun never doubles them).
    db.prepare(
      `UPDATE invoices SET vendor_id=?, invoice_number=?, invoice_date=?, due_date=?, subtotal_cents=?, gst_hst_cents=?, pst_qst_cents=?, total_cents=?, currency=?,
       fx_rate_to_cad_bps=?, total_cad_cents=?, ship_to_province=?, ship_to_source=?, po_id=?, contract_id=?, extraction_json=?, extracted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`
    ).run(
      vendorId, x.invoiceNumber, x.invoiceDate, dueDate, subtotalCents, tax?.charged.gstHstCents ?? null, tax?.charged.pstQstCents ?? null, x.totalCents, x.currency,
      x.currency === "CAD" ? 10_000 : fx?.rateBps ?? null, totalCadCents, province, used?.source ?? null, po?.id ?? null, contract?.id ?? null, JSON.stringify(x), invoiceId
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
    // Runs one rule family, adds its findings to the flags in the same order as before, and logs the step.
    const checked = (name: string, okDetail: string, fn: () => Finding[]) => {
      const start = performance.now();
      const found = fn();
      flags.push(...found);
      stepFlags(name, found, okDetail, since(start));
    };
    checked("arithmetic", "Line items, taxes and total add up", () => checkArithmetic(x.lines.map((l) => ({ totalCents: l.amountCents })), x.taxes, x.totalCents));
    if (vendor && vendorId !== null) {
      flags.push(...tax!.findings);
      stepFlags("tax", tax!.findings, `Tax codes and amounts match the rules for ${province ?? "the place of supply"}`, taxMs);
      checked("duplicates", "No duplicate or near-duplicate among this vendor's other invoices", () => {
        const others = db
          .prepare("SELECT id, invoice_number, total_cents, invoice_date FROM invoices WHERE vendor_id = ? AND id != ? AND invoice_number != ''")
          .all(vendorId, invoiceId) as { id: number; invoice_number: string; total_cents: number; invoice_date: string }[];
        return findDuplicates(
          { id: String(invoiceId), vendorId: String(vendorId), number: x.invoiceNumber, totalCents: x.totalCents, date: x.invoiceDate, kind: isCredit ? "credit_note" : "invoice" },
          others.map((o) => ({ id: String(o.id), vendorId: String(vendorId), number: o.invoice_number, totalCents: o.total_cents, date: o.invoice_date, kind: o.total_cents < 0 ? "credit_note" : "invoice" }))
        );
      });
      checked("bank", "Bank details agree with the vendor record", () => {
        const found = bankFindings(db, vendor, x);
        // A request still waiting for its callback is not on file yet. Whatever account this invoice shows, hold it until a finance user verifies.
        if (db.prepare("SELECT 1 FROM vendor_bank_changes WHERE vendor_id = ? AND status = 'pending'").get(vendorId))
          found.push(error("bank_change_unverified", "Vendor bank change not yet verified by callback"));
        return found;
      });

      if (isCredit) {
        checked("credit_note", "The credit note matches an earlier invoice of this vendor", () => {
          const credit = creditFindings(db, x, vendorId, invoiceId);
          if (credit.originalId !== null) writeAudit({ actorId, action: "invoice.credit_linked", entity: "invoice", entityId: invoiceId, after: { originalInvoiceId: credit.originalId } });
          return credit.findings;
        });
        skipAll(["po_match", "contract_match", "split", "cross_payment", "budget_anomaly"], "Not run for a credit note");
      } else {
        // A PO is checked when the invoice names one or the vendor must have one (P13); a contract when the vendor has one.
        if (x.poNumber || vendor.requires_po) checked("po_match", "The invoice fits the purchase order", () => poFindings(db, po, x, vendorId, invoiceId, subtotalCents));
        else step("po_match", "skipped", "The invoice names no PO and the vendor does not require one");
        if (contract) checked("contract_match", "The invoice fits the vendor contract", () => contractFindings(db, contract, x, vendorId, invoiceId, subtotalCents));
        else step("contract_match", "skipped", "No contract on file for this vendor");
        if (totalCadCents !== null) {
          // The limit is the department manager's own: pieces that each fit under it but together do not are a split.
          if (ctx.limitCents)
            checked("split", "No split of one purchase across several invoices", () => {
              const recent = db
                .prepare("SELECT CAST(id AS TEXT) AS id, CAST(vendor_id AS TEXT) AS vendorId, total_cad_cents AS totalCents, invoice_date AS date FROM invoices WHERE vendor_id = ? AND id != ? AND total_cad_cents IS NOT NULL AND status != 'rejected' AND ABS(julianday(invoice_date) - julianday(?)) <= ?")
                .all(vendorId, invoiceId, x.invoiceDate, SPLIT_WINDOW_DAYS) as { id: string; vendorId: string; totalCents: number; date: string }[];
              return findSplitInvoices({ id: String(invoiceId), vendorId: String(vendorId), totalCents: totalCadCents, date: x.invoiceDate }, recent, ctx.limitCents!, SPLIT_WINDOW_DAYS);
            });
          else step("split", "skipped", "The department manager has no approval limit to compare against");
          checked("cross_payment", "No matching payment already seen on the bank or card statements", () => crossFindings(db, vendor, invoiceId, x.invoiceDate, totalCadCents));
          // Warnings only (bonus rules): a department over its budget so far, and an amount far above this vendor's usual.
          checked("budget_anomaly", "Within budget and in line with this vendor's usual amounts", () => {
            const requesterId = (db.prepare("SELECT requester_id AS r FROM invoices WHERE id = ?").get(invoiceId) as { r: number | null }).r;
            return budgetAndAnomalyFlags(db, { invoiceId, vendorId, requesterId, totalCadCents, asOf: AS_OF });
          });
        } else skipAll(["split", "cross_payment", "budget_anomaly"], "The total could not be converted to CAD");
      }

      // Coding is decided per line (rules/coding.ts), applied to the line and audited with its reason.
      const codingStart = performance.now();
      const past = db
        .prepare(
          `SELECT l.invoice_id AS invoiceId, l.description, g.code AS accountCode FROM invoice_lines l
           JOIN invoices i ON i.id = l.invoice_id JOIN gl_accounts g ON g.id = l.gl_account_id
           WHERE i.vendor_id = ? AND i.id != ? AND i.status != 'rejected'`
        )
        .all(vendorId, invoiceId) as { invoiceId: number; description: string; accountCode: string }[];
      const known = (code: string | null) => (code && db.prepare("SELECT 1 FROM gl_accounts WHERE code = ?").get(code) ? code : null); // an unknown default is no default
      const defaultAccount = known((db.prepare("SELECT default_gl_account AS a FROM vendors WHERE id = ?").get(vendorId) as { a: string | null }).a);
      // Department: the PO's when the invoice has one, else the requester's.
      const deptId = po?.department_id ?? (db.prepare("SELECT u.department_id AS d FROM invoices i JOIN users u ON u.id = i.requester_id WHERE i.id = ?").get(invoiceId) as { d: number | null } | undefined)?.d ?? null;
      const deptWhy = po?.department_id ? "PO department" : deptId ? "requester's department" : "no department known";
      // Tax code per line from where the goods go (never copied from history); a vendor that charges no tax keeps its exempt code.
      const taxCodes = (db.prepare("SELECT code, rate_bps, applies_to FROM tax_codes").all() as { code: string; rate_bps: number; applies_to: string | null }[]).map(
        (c): TaxCodeRate => ({ code: c.code, rateE5: Math.round(c.rate_bps * 10), appliesTo: c.applies_to === "goods" ? "goods" : "all" })
      );
      const required = requiredTaxCodes(province ?? "", tax!.lineType, taxCodes);
      const taxCode = tax!.gstCode && ["EXEMPT", "FOREIGN"].includes(tax!.gstCode) ? tax!.gstCode : required?.gstHst ?? null;
      const taxWhy = taxCode ? `tax ${taxCode} for ${province} ${tax!.lineType}${used ? ` (place of supply: ${SUPPLY_LABEL[used.source]})` : ""}` : `no tax rules for province ${province ?? "(unknown)"}`;
      const lines = db.prepare("SELECT id, description FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no").all(invoiceId) as { id: number; description: string }[];
      const update = db.prepare(
        "UPDATE invoice_lines SET gl_account_id = (SELECT id FROM gl_accounts WHERE code = ?), tax_code_id = (SELECT id FROM tax_codes WHERE code = ?), department_id = ?, coding_source = ?, coding_reason = ?, coding_needed = ? WHERE id = ?"
      );
      const results = lines.map((l) => {
        const c = codeLine(l.description, past, defaultAccount);
        const account = c.status === "coded" ? c.accountCode : null;
        update.run(account, taxCode, deptId, c.status === "coded" ? c.source : "none", `${c.reason}; ${taxWhy}; department: ${deptWhy}`, account ? 0 : 1, l.id);
        return { lineId: l.id, ...c, taxCode, departmentId: deptId };
      });
      writeAudit({ actorId, action: "invoice.coding_suggestion", entity: "invoice", entityId: invoiceId, after: { lines: results } });
      const missing = results.filter((r) => r.status === "coding_needed").length;
      const codingFlags: Finding[] = missing ? [warning("coding_needed", `${missing} line(s) have no account; a clerk or manager must set it before approval`)] : [];
      flags.push(...codingFlags);
      stepFlags("coding", codingFlags, `Suggested an account and tax code for ${results.length} line(s)`, since(codingStart));
    } else {
      skipAll(["tax", "duplicates", "bank", "po_match", "contract_match", "split", "cross_payment", "budget_anomaly", "coding"], "No vendor was matched");
    }

    // Routing only matters if nothing needs a human first.
    if (flags.some((f) => f.severity === "error")) return finish(flags, null);
    // The chain is stored as pending steps; if nobody can fill a step, a human looks at it.
    const routeStart = performance.now();
    try {
      const steps = createChain(invoiceId, actorId);
      step("approval_routing", "ok", `Built an approval chain of ${steps.length} step(s)`, since(routeStart));
      routingLogged = true;
      return finish(flags, Number(steps[0].userId));
    } catch (e) {
      const message = e instanceof Error ? e.message : "approval routing failed";
      step("approval_routing", "failed", message, since(routeStart));
      routingLogged = true;
      return finish([...flags, error("routing_failed", message)], null);
    }
  })();
}

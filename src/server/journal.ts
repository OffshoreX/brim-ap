import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { formatCents } from "./payments";
import { REPORT_ROLES, toCsv } from "./reports";

// Journal export (T82): approved, scheduled and paid invoices as balanced double entries for an accounting system.
// Everything is integer cents until the last step, where formatCents turns cents into a decimal string. No floats anywhere.
export const JOURNAL_ROLES = REPORT_ROLES;
export const JOURNAL_COLUMNS = ["entry_id", "date", "invoice_number", "vendor", "account_code", "account_name", "debit", "credit", "currency", "memo", "debit_cad", "credit_cad"];

// The dataset's chart has Accounts Payable (2100) but no bank or purchase-discount account, so these two are ours.
// ponytail: fixed codes; make them settings if the accounting system numbers its bank account differently.
const AP_CODE = "2100";
const BANK = { code: "1010", name: "Bank - operating account" };
const DISCOUNTS = { code: "7030", name: "Purchase Discounts Taken" };

// One bad invoice stops the whole export: a wrong file is worse than no file.
export class JournalError extends Error {
  constructor(public invoiceId: number, message: string) {
    super(message);
  }
}

// cents > 0 is a debit, cents < 0 a credit. A credit note simply has the signs reversed, no special case.
type Leg = { code: string; name: string; cents: number; memo: string };
type Entry = { id: string; date: string; inv: InvoiceRow; legs: Leg[]; apIndex: number; apCad: number };
type InvoiceRow = { id: number; invoice_number: string; invoice_date: string; status: string; currency: string; total_cents: number; total_cad_cents: number | null; fx_rate_to_cad_bps: number | null; gst_hst_cents: number | null; pst_qst_cents: number | null; vendor: string | null };
type LineRow = { invoice_id: number; description: string; amount_cents: number; gst_hst_code: string | null; pst_qst_code: string | null; gl: string | null };
type PaymentRow = { id: number; invoice_id: number; amount_cents: number; discount_taken_cents: number; currency: string; paid_at: string; reference: string | null };

const floorDiv = (a: bigint, b: bigint) => (a % b !== 0n && a < 0n ? a / b - 1n : a / b); // b > 0

// Splits `target` over `weights` in proportion, in whole cents, so the parts add up to exactly `target`
// (largest remainder; BigInt because cents x cents can pass 2^53). Works for negative weights too.
export function allocate(target: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) {
    if (target !== 0) throw new Error(`cannot split ${target} cents over amounts that add up to zero`);
    return weights.map(() => 0);
  }
  const sign = total < 0 ? -1n : 1n;
  const div = BigInt(total) * sign;
  const exact = weights.map((w) => BigInt(w) * sign * BigInt(target));
  const parts = exact.map((e) => floorDiv(e, div));
  const left = Number(BigInt(target) - parts.reduce((a, b) => a + b, 0n)); // 0 <= left < weights.length
  const order = exact.map((e, i) => ({ i, r: e - parts[i] * div })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; k < left; k++) parts[order[k].i] += 1n;
  return parts.map(Number);
}

// round(n * num / den), half up, in integer math.
function scale(n: number, num: number, den: number): number {
  if (den === 0) return 0;
  const s = den < 0 ? -1n : 1n;
  const d = BigInt(den) * s;
  return Number(floorDiv(2n * BigInt(n) * BigInt(num) * s + d, 2n * d));
}

type TaxCode = { recoverable: string | null; gl_account: string | null };

// Debits each line's account for its pre-tax amount, recoverable tax to the tax code's receivable account, and credits payables for the total.
// Tax that cannot be recovered (BC PST) is part of what the goods cost, so it is added to the lines that carried it.
function invoiceEntry(inv: InvoiceRow, lines: LineRow[], taxCodes: Map<string, TaxCode>, name: (code: string) => string): Entry {
  const extra = lines.map(() => 0);
  const recoverable = new Map<string, number>(); // receivable account code -> cents
  const charges: [number, (l: LineRow) => string | null][] = [
    [inv.gst_hst_cents ?? 0, (l) => l.gst_hst_code],
    [inv.pst_qst_cents ?? 0, (l) => l.pst_qst_code],
  ];
  for (const [cents, codeOf] of charges) {
    if (cents === 0) continue;
    const idx = lines.flatMap((l, i) => (codeOf(l) ? [i] : []));
    if (!idx.length) throw new Error("tax was charged but no line has a tax code");
    const shares = allocate(cents, idx.map((i) => lines[i].amount_cents));
    idx.forEach((i, k) => {
      const code = codeOf(lines[i])!;
      const tc = taxCodes.get(code);
      if (!tc) throw new Error(`unknown tax code ${code}`);
      if (tc.recoverable !== "yes") extra[i] += shares[k];
      else if (!tc.gl_account) throw new Error(`tax code ${code} is recoverable but has no receivable account`);
      else recoverable.set(tc.gl_account, (recoverable.get(tc.gl_account) ?? 0) + shares[k]);
    });
  }
  const legs: Leg[] = lines.map((l, i) => {
    if (!l.gl) throw new Error(`line "${l.description}" has no GL account`);
    return { code: l.gl, name: name(l.gl), cents: l.amount_cents + extra[i], memo: extra[i] ? `${l.description} (incl. non-recoverable tax)` : l.description };
  });
  for (const [code, cents] of recoverable) legs.push({ code, name: name(code), cents, memo: "Recoverable tax" });
  legs.push({ code: AP_CODE, name: name(AP_CODE), cents: -inv.total_cents, memo: `Invoice ${inv.invoice_number}` });
  return { id: `JE-${inv.id}`, date: inv.invoice_date, inv, legs, apIndex: legs.length - 1, apCad: -totalCad(inv) };
}

// CAD invoices are their own CAD amount; a foreign one uses the CAD total stored with its rate.
function totalCad(inv: InvoiceRow): number {
  if (inv.currency === "CAD") return inv.total_cents;
  if (inv.total_cad_cents !== null) return inv.total_cad_cents;
  if (inv.fx_rate_to_cad_bps !== null) return scale(inv.total_cents, inv.fx_rate_to_cad_bps, 10_000);
  throw new Error(`${inv.currency} invoice has no CAD total or rate`);
}

// A settled payment clears payables for what was paid plus any early-pay discount taken; the bank is credited with the cash that left.
// Installments: the CAD side is cut from the running total, so the parts add up to the invoice's CAD total to the cent.
function paymentEntries(inv: InvoiceRow, pays: PaymentRow[], name: (code: string) => string): Entry[] {
  const cad = totalCad(inv);
  let paid = 0;
  let paidCad = 0;
  return pays.map((p) => {
    if (p.currency !== inv.currency) throw new Error(`payment ${p.id} is in ${p.currency}, the invoice in ${inv.currency}`);
    const apDebit = p.amount_cents + p.discount_taken_cents;
    paid += apDebit;
    const upTo = inv.currency === "CAD" ? paid : scale(paid, cad, inv.total_cents);
    const apCad = upTo - paidCad;
    paidCad = upTo;
    const memo = `Payment ${p.reference ?? p.id}`;
    const legs: Leg[] = [{ code: AP_CODE, name: name(AP_CODE), cents: apDebit, memo }, { code: BANK.code, name: BANK.name, cents: -p.amount_cents, memo }];
    if (p.discount_taken_cents) legs.push({ code: DISCOUNTS.code, name: DISCOUNTS.name, cents: -p.discount_taken_cents, memo: `Early-pay discount, ${memo}` });
    return { id: `JE-${inv.id}-PAY-${p.id}`, date: p.paid_at.slice(0, 10), inv, legs, apIndex: 0, apCad };
  });
}

// Turns one entry into CSV rows. The CAD figures are the payables leg's CAD amount spread over the other legs, so both columns balance exactly.
function entryRows(e: Entry): Record<string, string | number>[] {
  const sum = e.legs.reduce((a, l) => a + l.cents, 0);
  if (sum !== 0) throw new Error(`entry ${e.id} does not balance: debits minus credits is ${sum} cents`);
  const others = e.legs.filter((_, i) => i !== e.apIndex);
  const split = allocate(-e.apCad, others.map((l) => l.cents));
  let k = 0;
  const cads = e.legs.map((_, i) => (i === e.apIndex ? e.apCad : split[k++]));
  if (cads.reduce((a, b) => a + b, 0) !== 0) throw new Error(`entry ${e.id} does not balance in CAD`);
  const side = (cents: number, debit: boolean) => (debit === cents > 0 && cents !== 0 ? formatCents(Math.abs(cents)) : "");
  return e.legs.flatMap((l, i) =>
    l.cents === 0 && cads[i] === 0
      ? []
      : [{
          entry_id: e.id, date: e.date, invoice_number: e.inv.invoice_number, vendor: e.inv.vendor ?? "", account_code: l.code, account_name: l.name,
          debit: side(l.cents, true), credit: side(l.cents, false), currency: e.inv.currency, memo: l.memo, debit_cad: side(cads[i], true), credit_cad: side(cads[i], false),
        }]
  );
}

const group = <T extends { invoice_id: number }>(rows: T[]) => {
  const m = new Map<number, T[]>();
  for (const r of rows) m.set(r.invoice_id, [...(m.get(r.invoice_id) ?? []), r]);
  return m;
};

// Role is checked by the route. Reads, builds every entry, and only then writes the audit row, so a failed export is never logged as done.
export function exportJournal(user: User, from: string, to: string): string {
  const db = getDb();
  const invoices = db
    .prepare(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.status, i.currency, i.total_cents, i.total_cad_cents, i.fx_rate_to_cad_bps, i.gst_hst_cents, i.pst_qst_cents, v.name AS vendor
       FROM invoices i LEFT JOIN vendors v ON v.id = i.vendor_id
       WHERE i.status IN ('approved','scheduled','paid') AND i.invoice_date >= ? AND i.invoice_date <= ? ORDER BY i.invoice_date, i.id`
    )
    .all(from, to) as InvoiceRow[];
  const inRange = (statuses: string) => `SELECT id FROM invoices WHERE status IN (${statuses}) AND invoice_date >= ? AND invoice_date <= ?`;
  const lines = group(
    db
      .prepare(
        `SELECT l.invoice_id, l.description, l.amount_cents, l.gst_hst_code, l.pst_qst_code, g.code AS gl FROM invoice_lines l
         LEFT JOIN gl_accounts g ON g.id = l.gl_account_id WHERE l.invoice_id IN (${inRange("'approved','scheduled','paid'")}) ORDER BY l.invoice_id, l.line_no, l.id`
      )
      .all(from, to) as LineRow[]
  );
  // Only released money is a bank entry; a payment still scheduled or outstanding has not left the bank.
  const payments = group(
    db
      .prepare(
        `SELECT id, invoice_id, amount_cents, discount_taken_cents, currency, paid_at, reference FROM payments
         WHERE status = 'settled' AND paid_at IS NOT NULL AND invoice_id IN (${inRange("'paid'")}) ORDER BY paid_at, id`
      )
      .all(from, to) as PaymentRow[]
  );
  const taxCodes = new Map((db.prepare("SELECT code, recoverable, gl_account FROM tax_codes").all() as (TaxCode & { code: string })[]).map((t) => [t.code, t]));
  const names = new Map((db.prepare("SELECT code, name FROM gl_accounts").all() as { code: string; name: string }[]).map((a) => [a.code, a.name]));
  const name = (code: string) => {
    const n = names.get(code);
    if (n === undefined) throw new Error(`account ${code} is not in the chart of accounts`);
    return n;
  };

  const rows: Record<string, string | number>[] = [];
  let entries = 0;
  for (const inv of invoices) {
    try {
      const made = [invoiceEntry(inv, lines.get(inv.id) ?? [], taxCodes, name), ...(inv.status === "paid" ? paymentEntries(inv, payments.get(inv.id) ?? [], name) : [])];
      entries += made.length;
      for (const e of made) rows.push(...entryRows(e));
    } catch (e) {
      throw new JournalError(inv.id, `Invoice ${inv.id} cannot be exported: ${(e as Error).message}`);
    }
  }
  writeAudit({
    actorId: user.id, action: "journal.export", entity: "journal", entityId: `${from}..${to}`,
    after: { from, to, format: "csv", invoices: invoices.length, entries, rows: rows.length },
  });
  return toCsv(rows, JOURNAL_COLUMNS);
}

// "2026-02-30" has the right shape but is not a day, so the date is round-tripped.
const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// A string is the 400 message; otherwise the checked range.
export function parseJournalQuery(q: URLSearchParams): string | { from: string; to: string } {
  const from = q.get("from");
  const to = q.get("to");
  if (!isDay(from) || !isDay(to)) return "from and to are required and must be real dates as yyyy-mm-dd";
  if (from > to) return "from must not be after to";
  const format = q.get("format");
  if (format !== null && format !== "csv") return "format must be csv";
  return { from, to };
}

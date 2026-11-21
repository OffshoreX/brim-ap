import { randomBytes } from "node:crypto";
import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { convertCents } from "./rules/fx";
import { chooseMethod, discountCentsFor, dueDateFor, parseEarlyPayTerms, proposedPayDate } from "./rules/paymentTerms";
import { canRelease } from "./rules/release";
import type { ReleaseTier } from "./rules/types";
import { transition } from "./invoiceStatus";

// Response types live here, not in contracts.ts (lead-owned).
export const METHODS = ["EFT", "CHEQUE", "CARD"] as const;
export type Method = (typeof METHODS)[number];
export type PrepareResponse = { paymentId: number; invoiceId: number; status: "scheduled"; method: Method; scheduledDate: string; earlyPay: boolean; notes: string[] };
export type ReleaseResponse = { paymentId: number; invoiceId: number; status: "paid"; method: Method; reference: string; discountCents: number };

// Carries the HTTP status so routes stay thin; 401/403 from authz use HttpError instead.
export class PaymentError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

// Policy P09/P10 as data: up to 100,000.00 CAD (10,000,000 cents) finance_manager or above, over that controller_admin.
// The policy rows are prose, so the table lives here and is handed to canRelease as an argument.
export const RELEASE_TIERS: readonly ReleaseTier[] = [
  { upToCents: 10_000_000, roles: ["finance_manager", "controller_admin"] },
  { upToCents: null, roles: ["controller_admin"] },
];

type InvoiceRow = {
  status: string; total_cents: number; currency: string; total_cad_cents: number | null; due_date: string | null; vendor_id: number | null;
  invoice_date: string; fx_rate_to_cad_bps: number | null;
};
type PaymentRow = {
  id: number; invoice_id: number; status: string; method: Method; amount_cents: number; amount_cad_cents: number | null; prepared_by: number | null;
  currency: string; fx_rate_to_cad_bps: number | null;
};
type VendorRow = { m: Method | null; card: number | null; discount: string | null; termsDays: number | null };

const today = () => new Date().toISOString().slice(0, 10);

// USD is paid at the fx_rates row for the INVOICE date (the same rate the invoice was converted at, and the one
// payments.csv uses), never the payment date, so the CAD amount matches the books. CAD is 1:1; no rate means no payment.
function rateBps(db: ReturnType<typeof getDb>, currency: string, stored: number | null, invoiceDate: string): number | null {
  if (currency === "CAD") return 10_000;
  if (stored !== null) return stored;
  if (currency !== "USD") return null;
  return (db.prepare("SELECT usd_to_cad_bps AS bps FROM fx_rates WHERE date = ?").get(invoiceDate) as { bps: number } | undefined)?.bps ?? null;
}

// Step 1: a clerk (or above) schedules an approved invoice. No money moves yet.
export function preparePayment(user: User, input: { invoiceId: number; method?: Method; scheduledDate?: string }): PrepareResponse {
  const db = getDb();
  // One transaction: payment row, status change and audit rows all succeed or all roll back.
  return db.transaction(() => {
    const inv = db
      .prepare("SELECT status, total_cents, currency, total_cad_cents, due_date, vendor_id, invoice_date, fx_rate_to_cad_bps FROM invoices WHERE id = ?")
      .get(input.invoiceId) as InvoiceRow | undefined;
    if (!inv) throw new PaymentError(404, "Invoice not found");
    // Once prepared the invoice is scheduled, so a second prepare lands here too.
    if (inv.status !== "approved") throw new PaymentError(409, `Invoice is ${inv.status}, not approved`);
    // The limit check needs CAD; a CAD invoice is its own CAD amount, a foreign one is converted at the invoice-date rate.
    const bps = rateBps(db, inv.currency, inv.fx_rate_to_cad_bps, inv.invoice_date);
    let amountCad = inv.total_cad_cents;
    if (amountCad === null && bps !== null) amountCad = convertCents(inv.total_cents, inv.currency, "CAD", { from: inv.currency, to: "CAD", rateBps: bps });
    if (amountCad === null) throw new PaymentError(409, "Invoice has no CAD amount, convert it first");
    const vendor = (inv.vendor_id === null
      ? undefined
      : db.prepare("SELECT preferred_payment_method AS m, accepts_card_payment AS card, early_pay_discount AS discount, payment_terms_days AS termsDays FROM vendors WHERE id = ?").get(inv.vendor_id)) as VendorRow | undefined;
    const notes: string[] = [];
    const choice = chooseMethod(vendor?.m ?? null, vendor?.card === 1, input.method);
    if (!choice.ok) throw new PaymentError(409, choice.reason);
    const method = choice.method;
    if (choice.note) notes.push(choice.note);
    // Discount terms we cannot read mean no discount and a visible note, never a guess.
    const terms = parseEarlyPayTerms(vendor?.discount);
    if (terms.kind === "unparsed") notes.push(terms.note);
    const proposal = proposedPayDate(terms, inv.invoice_date, inv.due_date ?? dueDateFor(inv.invoice_date, vendor?.termsDays), today());
    const scheduledDate = input.scheduledDate ?? proposal.date;
    const early = input.scheduledDate === undefined && proposal.early;
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO payments (invoice_id, vendor_id, method, scheduled_date, paid_at, amount_cents, currency, fx_rate_to_cad_bps, amount_cad_cents, status, prepared_by)
         VALUES (?,?,?,?,NULL,?,?,?,?,'scheduled',?)`
      )
      .run(input.invoiceId, inv.vendor_id, method, scheduledDate, inv.total_cents, inv.currency, bps, amountCad, user.id);
    const paymentId = Number(lastInsertRowid);
    transition(input.invoiceId, "scheduled", user.id);
    writeAudit({
      actorId: user.id,
      action: "payment.prepare",
      entity: "payment",
      entityId: paymentId,
      after: { invoiceId: input.invoiceId, method, scheduledDate, amountCents: inv.total_cents, currency: inv.currency, amountCadCents: amountCad, notes },
    });
    return { paymentId, invoiceId: input.invoiceId, status: "scheduled" as const, method, scheduledDate, earlyPay: early, notes };
  })();
}

// Step 2: a different, senior-enough user pays it. The route checked the role; canRelease checks size and separation of duties.
export function releasePayment(user: User, paymentId: number, now: string = today()): ReleaseResponse {
  const db = getDb();
  return db.transaction(() => {
    const pay = db
      .prepare("SELECT id, invoice_id, status, method, amount_cents, amount_cad_cents, prepared_by, currency, fx_rate_to_cad_bps FROM payments WHERE id = ?")
      .get(paymentId) as PaymentRow | undefined;
    if (!pay) throw new PaymentError(404, "Payment not found");
    // A released payment is settled, so a second release lands here too.
    if (pay.status !== "scheduled") throw new PaymentError(409, `Payment is ${pay.status}, not scheduled`);
    const approverIds = (db.prepare("SELECT approver_id FROM approvals WHERE invoice_id = ?").all(pay.invoice_id) as { approver_id: number }[]).map((r) => r.approver_id);
    const check = canRelease(
      { id: user.id, role: user.role },
      { amountCadCents: pay.amount_cad_cents ?? 0, approverIds, preparedBy: pay.prepared_by },
      RELEASE_TIERS
    );
    if (!check.allowed) throw new PaymentError(403, check.reason);
    const inv = db
      .prepare("SELECT subtotal_cents, invoice_date, vendor_id FROM invoices WHERE id = ?")
      .get(pay.invoice_id) as { subtotal_cents: number | null; invoice_date: string; vendor_id: number | null };
    const termsText = inv.vendor_id === null ? null : (db.prepare("SELECT early_pay_discount AS t FROM vendors WHERE id = ?").get(inv.vendor_id) as { t: string | null }).t;
    // Only a release inside the window takes the discount; the proposal at prepare time is just a suggestion.
    const discountCents = discountCentsFor(parseEarlyPayTerms(termsText), inv.invoice_date, now, inv.subtotal_cents ?? 0);
    const bps = rateBps(db, pay.currency, pay.fx_rate_to_cad_bps, inv.invoice_date);
    // Without a discount the CAD amount fixed at prepare time stands; a net amount needs the rate to be converted.
    if (bps === null && discountCents > 0) throw new PaymentError(409, "No exchange rate for this payment");
    // A card payment gets a fresh single-use virtual card reference; the others reference the payment id.
    const reference = pay.method === "CARD" ? `BRIM-VC-${randomBytes(5).toString("hex").toUpperCase()}` : `PAY-${pay.id}`;
    const paidCents = pay.amount_cents - discountCents;
    // The CAD amount follows what is actually paid: convert the net amount, rounding half up to a whole cent (see rules/fx.ts).
    const paidCadCents = bps === null ? (pay.amount_cad_cents as number) : convertCents(paidCents, pay.currency, "CAD", { from: pay.currency, to: "CAD", rateBps: bps });
    db.prepare(
      "UPDATE payments SET status = 'settled', paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), amount_cents = ?, amount_cad_cents = ?, fx_rate_to_cad_bps = ?, discount_taken_cents = ?, reference = ?, released_by = ? WHERE id = ?"
    ).run(paidCents, paidCadCents, bps, discountCents, reference, user.id, pay.id);
    transition(pay.invoice_id, "paid", user.id);
    writeAudit({
      actorId: user.id,
      action: "payment.release",
      entity: "payment",
      entityId: pay.id,
      before: { status: "scheduled", amountCents: pay.amount_cents, amountCadCents: pay.amount_cad_cents },
      after: { status: "settled", amountCents: paidCents, amountCadCents: paidCadCents, discountCents, reference, method: pay.method },
    });
    return { paymentId: pay.id, invoiceId: pay.invoice_id, status: "paid" as const, method: pay.method, reference, discountCents };
  })();
}

// 12345 -> "123.45", integer math only.
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Only released EFT payments go to the bank file.
export function eftFileCsv(): string {
  const rows = getDb()
    .prepare(
      `SELECT p.id, i.invoice_number, v.name AS vendor, v.bank_institution, v.bank_transit, v.bank_account, p.amount_cents, p.currency, p.reference
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN vendors v ON v.id = i.vendor_id
       WHERE p.method = 'EFT' AND p.status = 'settled'
       ORDER BY p.id`
    )
    .all() as {
    id: number;
    invoice_number: string;
    vendor: string | null;
    bank_institution: string | null;
    bank_transit: string | null;
    bank_account: string | null;
    amount_cents: number;
    currency: string;
    reference: string | null;
  }[];
  const lines = rows.map((r) =>
    [r.invoice_number, r.vendor ?? "", [r.bank_institution, r.bank_transit, r.bank_account].filter(Boolean).join("-"), formatCents(r.amount_cents), r.currency, r.reference ?? `PAY-${r.id}`]
      .map(csvCell)
      .join(",")
  );
  return ["invoice_number,vendor,bank_details,amount,currency,reference", ...lines].join("\n") + "\n";
}

// Released cheques to print, newest last; the vendor name and address are what the cheque needs.
export function chequeList() {
  return getDb()
    .prepare(
      `SELECT p.id AS paymentId, i.invoice_number AS invoiceNumber, v.name AS vendor, v.address, p.amount_cents AS amountCents, p.currency, p.reference
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN vendors v ON v.id = i.vendor_id
       WHERE p.method = 'CHEQUE' AND p.status = 'settled'
       ORDER BY p.id`
    )
    .all();
}

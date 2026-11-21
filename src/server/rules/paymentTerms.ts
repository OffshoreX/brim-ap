// Payment terms as plain functions: early-pay discount parsing, due dates, and which method a vendor is paid by.
// Dates are ISO yyyy-mm-dd strings, so they compare correctly as text.

import type { Finding } from "./types";

export type EarlyPayTerms =
  | { kind: "none" }
  | { kind: "discount"; percentBps: number; discountDays: number; netDays: number }
  | { kind: "unparsed"; note: string };

// vendors.csv has exactly two values in early_pay_discount: blank (53 vendors) and "2/10 net 30" (3 vendors).
// Case and spacing are tolerated; anything else is "unparsed" (no discount, visible note), never a guess.
const TERMS = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s+net\s*(\d+)$/i;

export function parseEarlyPayTerms(text: string | null | undefined): EarlyPayTerms {
  const t = (text ?? "").trim();
  if (t === "") return { kind: "none" };
  const m = TERMS.exec(t);
  const unparsed: EarlyPayTerms = { kind: "unparsed", note: `Early-pay terms "${t}" are not understood, so no discount is applied` };
  if (!m) return unparsed;
  // Percent becomes basis points (2 -> 200) so money maths stays in integers.
  const percentBps = Math.round(Number(m[1]) * 100);
  const discountDays = Number(m[2]);
  const netDays = Number(m[3]);
  // A discount of 0% or over 100%, or a window longer than the net period, is a typo, not terms.
  if (percentBps <= 0 || percentBps > 10_000 || discountDays > netDays) return unparsed;
  return { kind: "discount", percentBps, discountDays, netDays };
}

// Days to pay as printed on an invoice: "Net 30", "2/10 net 30", "payable within 45 days", "due on receipt" (0).
// Anything else is null: not understood is not the same as different.
export function parseTermsDays(text: string | null | undefined): number | null {
  const t = (text ?? "").toLowerCase();
  const m = /net\s*(\d+)/.exec(t) ?? /(\d+)\s*days?/.exec(t);
  if (m) return Number(m[1]);
  return /(due|payable)\s+(on|upon)\s+receipt|immediate/.test(t) ? 0 : null;
}

// The vendor record wins; this only tells a clerk that the invoice says something else.
export function checkPaymentTerms(invoiceText: string | null | undefined, vendorDays: number | null | undefined): Finding[] {
  const shown = parseTermsDays(invoiceText);
  if (shown === null || vendorDays === null || vendorDays === undefined || shown === vendorDays) return [];
  return [{ code: "payment_terms_differ", severity: "info", message: `Invoice says "${invoiceText!.trim()}" (${shown} days); the vendor record says ${vendorDays} days and is used` }];
}

// Calendar days in UTC, so daylight saving never shifts a date.
export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * 86_400_000).toISOString().slice(0, 10);
}

// Due date = invoice date + vendor payment_terms_days (0 means due on receipt). Null when the terms are unknown.
export function dueDateFor(invoiceDate: string, termsDays: number | null | undefined): string | null {
  return termsDays === null || termsDays === undefined || !Number.isInteger(termsDays) || termsDays < 0 ? null : addDays(invoiceDate, termsDays);
}

// Last day the discount applies (inclusive), or null when the vendor has no usable discount terms.
export function discountDeadline(terms: EarlyPayTerms, invoiceDate: string): string | null {
  return terms.kind === "discount" ? addDays(invoiceDate, terms.discountDays) : null;
}

// Discount in cents on the subtotal, rounded half up; zero outside the window [invoice date, deadline].
export function discountCentsFor(terms: EarlyPayTerms, invoiceDate: string, paidDate: string, subtotalCents: number): number {
  const deadline = discountDeadline(terms, invoiceDate);
  if (terms.kind !== "discount" || deadline === null || paidDate < invoiceDate || paidDate > deadline) return 0;
  return Math.round((subtotalCents * terms.percentBps) / 10_000);
}

// The payment run proposes paying early (on the deadline) only while today is still inside the window;
// otherwise it proposes the due date, or today when the due date is unknown.
export function proposedPayDate(terms: EarlyPayTerms, invoiceDate: string, dueDate: string | null, today: string): { date: string; early: boolean } {
  const deadline = discountDeadline(terms, invoiceDate);
  if (deadline !== null && today >= invoiceDate && today <= deadline) return { date: deadline, early: true };
  return { date: dueDate ?? today, early: false };
}

export type PayMethod = "EFT" | "CHEQUE" | "CARD";
export type MethodChoice = { ok: true; method: PayMethod; note?: string } | { ok: false; reason: string };

// CARD only when the vendor accepts card. A requested CARD that is not accepted is refused;
// a vendor whose preferred method is CARD but who does not accept it (bad master data) falls back to EFT with a note.
export function chooseMethod(preferred: PayMethod | null, acceptsCard: boolean, requested?: PayMethod): MethodChoice {
  if (requested) return requested === "CARD" && !acceptsCard ? { ok: false, reason: "This vendor does not accept card payments" } : { ok: true, method: requested };
  if (preferred === "CARD" && !acceptsCard) return { ok: true, method: "EFT", note: "Vendor prefers CARD but does not accept card payments; using EFT" };
  return { ok: true, method: preferred ?? "EFT" };
}

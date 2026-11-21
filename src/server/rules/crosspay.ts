import type { Finding } from './types';

const DAY_MS = 86_400_000;
export const CARD_WINDOW_DAYS = 14;
const AMOUNT_TOLERANCE_CENTS = 1;
// Truncated bank/card text is only trusted as a name prefix when it is this long.
const MIN_PREFIX = 8;

export type CrossInvoice = { id?: string; vendorId: string; totalCents: number; date: string };
export type CrossVendor = { id: string; legalName: string };
export type CardTxn = { id: string; merchant: string; amountCadCents: number; date: string };
export type BankTxn = { id: string; description: string; debitCents: number; date: string };
export type PaymentRow = { id: string; invoiceId?: string; vendorId: string; amountCents: number };

const SUFFIXES = new Set(['ltd', 'inc', 'corp', 'co', 'llc', 'limited', 'incorporated', 'company']);

// A cut-off suffix ("LIMI" for Limited) counts too: real descriptors are truncated mid-word.
const isSuffix = (w: string) => SUFFIXES.has(w) || (w.length >= 3 && [...SUFFIXES].some((x) => x.startsWith(w)));

// Case, punctuation and company suffixes are formatting, not identity.
export function normalizeName(s: string): string {
  const words = s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  while (words.length > 1 && isSuffix(words[words.length - 1])) words.pop();
  return words.join('');
}

// Card/bank text is cut to ~22 chars, so only the text may be a prefix of the vendor name;
// text with extra words ("... Group") is a different company.
export function nameMatches(text: string, vendorName: string): boolean {
  const a = normalizeName(text);
  const b = normalizeName(vendorName);
  if (a === b) return true;
  return a.length >= MIN_PREFIX && b.startsWith(a);
}

// Bank lines look like "EFT PMT <NAME> <REFERENCE>"; drop the channel prefix and numeric reference.
const bankPayee = (d: string) => d.replace(/^\s*(eft pmt|preauth debit|wire)\s+/i, '').replace(/\s+\d+\s*$/, '');

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

export function findCrossPayments(
  invoice: CrossInvoice,
  vendor: CrossVendor,
  cardTxns: CardTxn[],
  bankTxns: BankTxn[],
  payments: PaymentRow[],
): Finding[] {
  const out: Finding[] = [];
  const flag = (code: string, message: string) => out.push({ code, severity: 'error', message });

  for (const t of cardTxns) {
    if (
      Math.abs(t.amountCadCents - invoice.totalCents) <= AMOUNT_TOLERANCE_CENTS &&
      days(t.date, invoice.date) <= CARD_WINDOW_DAYS &&
      nameMatches(t.merchant, vendor.legalName)
    ) {
      flag('cross_paid_card', `Card transaction ${t.id} (${t.merchant}, ${t.date}) already matches this amount`);
    }
  }
  for (const t of bankTxns) {
    if (t.debitCents === invoice.totalCents && nameMatches(bankPayee(t.description), vendor.legalName)) {
      flag('cross_paid_bank', `Bank debit ${t.id} (${t.description}, ${t.date}) already matches this amount`);
    }
  }
  for (const p of payments) {
    // Skip the invoice's own payment row: that is its payment, not a second one.
    if (p.vendorId === vendor.id && p.amountCents === invoice.totalCents && (!invoice.id || p.invoiceId !== invoice.id)) {
      flag('cross_paid_payment', `Payment ${p.id} to this vendor for the same amount already exists`);
    }
  }
  return out;
}

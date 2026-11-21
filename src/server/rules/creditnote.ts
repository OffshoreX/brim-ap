import type { Finding } from './types';
import type { CreditNote, OriginalInvoice } from './split.types';

// A credit note must point at a real invoice of the same vendor and not refund more than is left.
export function checkCreditNote(note: CreditNote, originalInvoices: OriginalInvoice[]): Finding[] {
  if (!Number.isInteger(note.totalCents) || note.totalCents >= 0) {
    return [{ code: 'NOT_A_CREDIT_NOTE', message: 'Credit note total must be a negative whole number of cents', severity: 'error' }];
  }
  const orig = note.referencesInvoiceId ? originalInvoices.find((o) => o.id === note.referencesInvoiceId) : undefined;
  if (!orig) {
    return [{ code: 'CREDIT_NOTE_NO_ORIGINAL', message: 'Credit note does not reference an existing invoice', severity: 'error' }];
  }
  if (orig.vendorId !== note.vendorId) {
    return [{ code: 'CREDIT_NOTE_VENDOR_MISMATCH', message: 'Credit note vendor differs from the original invoice vendor', severity: 'error' }];
  }
  const left = orig.totalCents - orig.creditedCents;
  if (-note.totalCents > left) {
    return [{ code: 'CREDIT_NOTE_EXCEEDS_ORIGINAL', message: `Credit of ${-note.totalCents} cents exceeds the ${left} cents left on the original`, severity: 'error' }];
  }
  return [];
}

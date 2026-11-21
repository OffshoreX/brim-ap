import type { Finding, InvoiceKey } from './types';

const DAY_MS = 86_400_000;

// Trim, lowercase, strip leading zeros.
export const normalizeNumber = (n: string) => n.trim().toLowerCase().replace(/^0+(?=.)/, '');

export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

export function findDuplicates(inv: InvoiceKey, existing: InvoiceKey[]): Finding[] {
  const out: Finding[] = [];
  const num = normalizeNumber(inv.number);
  for (const e of existing) {
    // Different vendor, same invoice, or credit note vs invoice: never a duplicate.
    if (e.vendorId !== inv.vendorId || (e.id && e.id === inv.id)) continue;
    if ((e.kind ?? 'invoice') !== (inv.kind ?? 'invoice')) continue;
    const ref = e.id ?? e.number;
    const enum_ = normalizeNumber(e.number);
    if (enum_ === num) {
      out.push({ code: 'DUPLICATE_EXACT', message: `Same vendor and invoice number as ${ref}`, severity: 'error' });
      continue;
    }
    // Same total close in time is the signal. A close number alone is just the next one in the vendor's sequence
    // (000921 after 000919), and a monthly fee repeats its total all year, so neither counts without the 30-day window.
    const reasons: string[] = [];
    if (e.totalCents === inv.totalCents && days(e.date, inv.date) <= 30) {
      reasons.push('same total within 30 days');
      if (editDistance(enum_, num) <= 2) reasons.push('invoice number within edit distance 2');
    }
    if (reasons.length) {
      out.push({ code: 'DUPLICATE_NEAR', message: `Possible duplicate of ${ref}: ${reasons.join(', ')}`, severity: 'warning' });
    }
  }
  return out;
}

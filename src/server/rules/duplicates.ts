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

// A re-sent invoice shows up within days. A same-total bill a month later (monthly fee, retainer) is the next bill, not a duplicate:
// recurring vendors repeat the total with sequential numbers one character apart, on a 21 to 35 day rhythm, so nothing beyond these windows counts.
export const NEAR_WINDOW_DAYS = 7; // same total, any other number
export const TYPO_WINDOW_DAYS = 14; // same total, number one character off (a retyped copy takes a little longer to turn up)

// Exact duplicates (same vendor, same normalized number) are errors, all of them. Without one, a near duplicate is a warning when
// the vendor already has an invoice with the same total inside the window above. A different total is never a duplicate:
// a close number alone is the next one in the sequence (000921 after 000919).
export function findDuplicates(inv: InvoiceKey, existing: InvoiceKey[]): Finding[] {
  const num = normalizeNumber(inv.number);
  const sameVendor = existing.filter((e) => e.vendorId === inv.vendorId && !(e.id && e.id === inv.id) && (e.kind ?? 'invoice') === (inv.kind ?? 'invoice'));
  const exact = sameVendor.filter((e) => normalizeNumber(e.number) === num);
  if (exact.length) {
    return exact.map((e): Finding => ({ code: 'DUPLICATE_EXACT', message: `Same vendor and invoice number as ${e.id ?? e.number}`, severity: 'error' }));
  }
  const hits = sameVendor
    .filter((e) => e.totalCents === inv.totalCents)
    .map((e) => ({ e, gap: days(e.date, inv.date), typo: editDistance(normalizeNumber(e.number), num) <= 1 }))
    .filter((h) => h.gap <= (h.typo ? TYPO_WINDOW_DAYS : NEAR_WINDOW_DAYS))
    .sort((x, y) => x.gap - y.gap);
  if (!hits.length) return [];
  const { e, typo } = hits[0]; // one finding, citing the closest in time
  return [{ code: 'DUPLICATE_NEAR', message: `Possible duplicate of ${e.id ?? e.number}: same total within ${Math.round(hits[0].gap)} days${typo ? ', invoice number within one character' : ''}`, severity: 'warning' }];
}

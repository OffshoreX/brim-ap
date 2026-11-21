import type { CodedInvoice, CodingResult } from './types';

export const MIN_HISTORY = 3;

// Most frequent value and its count; null on a tie (never guess silently).
function top(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
  return { value: sorted[0][0], count: sorted[0][1] };
}

// Pure: suggest account and tax code from this vendor's past invoices only.
export function suggestCoding(vendorId: string, history: CodedInvoice[]): CodingResult {
  const own = history.filter((h) => h.vendorId === vendorId);
  if (own.length < MIN_HISTORY) {
    return { status: 'none', reason: `only ${own.length} past invoices, need ${MIN_HISTORY}` };
  }
  const account = top(own.map((h) => h.accountCode));
  const tax = top(own.map((h) => h.taxCode));
  if (!account || !tax) return { status: 'none', reason: 'history is tied, cannot pick a winner' };
  const n = own.length;
  return {
    status: 'suggested',
    accountCode: account.value,
    taxCode: tax.value,
    // Weakest of the two shares: we are only as sure as our least certain pick.
    confidence: Math.min(account.count, tax.count) / n,
    reason: `account used ${account.count} of ${n} times, tax code ${tax.count} of ${n}`,
  };
}

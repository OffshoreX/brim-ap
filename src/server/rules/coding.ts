import type { CodedLine, CodingResult } from './types';

export const MIN_INVOICES = 3; // step (b) needs this many past invoices
export const MIN_SIMILARITY = 0.5; // step (a): shared words / all words, on a 0..1 scale

// Most frequent value and its count; null on a tie (never guess silently).
function top(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  if (!sorted.length || (sorted.length > 1 && sorted[0][1] === sorted[1][1])) return null;
  return { value: sorted[0][0], count: sorted[0][1] };
}

// Words only: lowercase letters, digits dropped so "Fuel surcharge 12%" and "Fuel surcharge 11%" match.
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{2,}/g) ?? []);
export function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  const all = new Set([...x, ...y]).size;
  return all === 0 ? 0 : shared / all;
}

// Pure: pick a GL account for ONE line. Fallback order, each step with a reason a clerk can read:
// (a) this vendor's past lines with a similar description, (b) this vendor's most used account,
// (c) the vendor's default account, (d) nothing: the line is flagged coding_needed.
export function codeLine(description: string, history: CodedLine[], defaultAccount: string | null): CodingResult {
  const similar = history.filter((h) => similarity(description, h.description) >= MIN_SIMILARITY);
  const a = top(similar.map((h) => h.accountCode));
  if (a) return { status: 'coded', source: 'history_description', accountCode: a.value, reason: `${a.count} of ${similar.length} past lines with a similar description used account ${a.value}` };

  const invoices = new Set(history.map((h) => h.invoiceId)).size;
  const b = invoices >= MIN_INVOICES ? top(history.map((h) => h.accountCode)) : null;
  if (b) return { status: 'coded', source: 'history_overall', accountCode: b.value, reason: `account ${b.value} is this vendor's most used (${b.count} of ${history.length} lines, ${invoices} past invoices)` };

  if (defaultAccount) {
    return { status: 'coded', source: 'vendor_default', accountCode: defaultAccount, reason: `vendor default account ${defaultAccount} (${invoices < MIN_INVOICES ? `only ${invoices} past invoices, need ${MIN_INVOICES}` : 'history is tied'})` };
  }
  return { status: 'coding_needed', reason: 'no similar past line, no usable vendor history and no vendor default account' };
}

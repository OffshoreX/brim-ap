import type { Finding, Line, Tax } from './types';

// Integer cents only. toleranceCents defaults to 0: a cent off is a mismatch.
export function checkArithmetic(lines: Line[], taxes: Tax[], totalCents: number, toleranceCents = 0): Finding[] {
  const all = [...lines.map((l) => l.totalCents), ...taxes.map((t) => t.amountCents), totalCents];
  if (!all.every(Number.isSafeInteger)) {
    return [{ code: 'NON_INTEGER_CENTS', message: 'All amounts must be integer cents', severity: 'error' }];
  }
  const problems: Finding[] = [];
  if (lines.length === 0) {
    problems.push({ code: 'EMPTY_LINES', message: 'Invoice has no line items', severity: 'error' });
  }
  const sum = all.slice(0, -1).reduce((a, b) => a + b, 0);
  const diff = totalCents - sum;
  if (Math.abs(diff) > toleranceCents) {
    problems.push({
      code: 'TOTAL_MISMATCH',
      message: `Lines plus taxes = ${sum} cents but total is ${totalCents} (off by ${diff})`,
      severity: 'error',
    });
  }
  return problems;
}

import type { Finding } from './types';
import type { SplitInvoice } from './split.types';

const DAY_MS = 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

// Flags a vendor splitting one spend into pieces that each stay under the approval limit.
export function findSplitInvoices(
  invoice: SplitInvoice,
  recentInvoices: SplitInvoice[],
  approvalLimitCents: number,
  windowDays: number,
): Finding[] {
  // Only positive invoices of the same vendor inside the window count; credit notes are not spend.
  const others = recentInvoices.filter(
    (r) =>
      r.vendorId === invoice.vendorId &&
      !(r.id && r.id === invoice.id) &&
      r.totalCents > 0 &&
      daysApart(r.date, invoice.date) <= windowDays,
  );
  const group = [invoice, ...others];
  // "Split" means every piece is below the limit (an invoice at the limit is not hiding anything).
  if (group.length < 2 || group.some((g) => g.totalCents >= approvalLimitCents)) return [];
  const sum = group.reduce((s, g) => s + g.totalCents, 0);
  if (sum <= approvalLimitCents) return [];
  return [
    {
      code: 'POSSIBLE_SPLIT_INVOICE',
      message: `${group.length} invoices from this vendor within ${windowDays} days are each under the limit but total ${sum} cents (limit ${approvalLimitCents})`,
      severity: 'warning',
    },
  ];
}

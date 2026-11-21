import type { BankDetails, BankRecord, Finding } from './types';

const DAY_MS = 86_400_000;
export const RECENT_CHANGE_DAYS = 30;

// Spaces, dashes and case are formatting, not a real change.
const norm = (s = '') => s.replace(/[^a-z0-9]/gi, '').toUpperCase();
const same = (a: BankDetails, b: BankDetails) =>
  norm(a.accountNumber) === norm(b.accountNumber) && norm(a.routingNumber) === norm(b.routingNumber);

// `today` is passed in (ISO date) so the result never depends on the clock.
export function checkBankChange(invoiceBank: BankDetails, history: BankRecord[], today: string): Finding[] {
  if (history.length === 0) {
    return [{ code: 'bank_no_history', severity: 'warning', message: 'No bank details on file for this vendor' }];
  }
  const sorted = [...history].sort((a, b) => a.since.localeCompare(b.since));
  const latest = sorted[sorted.length - 1];
  const out: Finding[] = [];

  if (!same(invoiceBank, latest)) {
    out.push({ code: 'bank_differs_from_latest', severity: 'error', message: 'Invoice bank details differ from the latest on file' });
    if (!sorted.some((r) => same(invoiceBank, r))) {
      out.push({ code: 'bank_never_seen', severity: 'error', message: 'These bank details were never seen for this vendor' });
    }
  }
  // A single record is the first setup, not a change.
  const days = (Date.parse(today) - Date.parse(latest.since)) / DAY_MS;
  if (sorted.length > 1 && days >= 0 && days <= RECENT_CHANGE_DAYS) {
    out.push({ code: 'bank_changed_recently', severity: 'warning', message: `Vendor changed bank details ${Math.floor(days)} days ago` });
  }
  return out;
}

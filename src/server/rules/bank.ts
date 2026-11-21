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

// ---- Bank risk from the real history (T29) ----
// Kept next to checkBankChange because pipeline.ts (not ours to edit) still calls the old one.
export type VendorBank = { institution: string; transit: string; account: string; updatedAt?: string };
export type BankChangeRow = {
  changedAt: string; // ISO date
  channel: string; // e.g. phone_callback_verified, vendor_portal, email_request
  verifiedByCallback: boolean;
  oldLast4: string;
  newLast4: string;
};

const last4 = (s: string) => norm(s).slice(-4);
const ageDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS;

// The history keeps only last 4 digits, so the master record is the source of truth for equality
// and the history is used for risk and for the wording of the reason.
export function checkVendorBankRisk(
  invoice: { institution: string; transit: string; account: string; date: string },
  vendor: VendorBank,
  changes: BankChangeRow[],
  today: string
): Finding[] {
  const out: Finding[] = [];

  const differs =
    norm(invoice.institution) !== norm(vendor.institution) ||
    norm(invoice.transit) !== norm(vendor.transit) ||
    norm(invoice.account) !== norm(vendor.account);
  if (differs) {
    const inv = last4(invoice.account);
    const stale = changes.some((c) => c.oldLast4 === inv);
    const reason = stale ? 'matches an account the vendor replaced' : 'matches no account in the change history';
    out.push({
      code: 'bank_differs_from_master',
      severity: 'error',
      message: `Invoice bank details (account ending ${inv}) differ from vendor master (ending ${last4(vendor.account)}); ${reason}`,
    });
  }

  for (const c of changes) {
    if (!c.verifiedByCallback || c.channel === 'email_request') {
      out.push({
        code: 'bank_change_unverified',
        severity: 'error',
        message: `Bank change on ${c.changedAt} (${c.oldLast4} to ${c.newLast4}) via ${c.channel} was not verified by callback`,
      });
    }
    const d = ageDays(c.changedAt, today);
    if (d >= 0 && d <= RECENT_CHANGE_DAYS) {
      out.push({ code: 'bank_changed_recently', severity: 'warning', message: `Bank details changed ${Math.floor(d)} days ago (${c.oldLast4} to ${c.newLast4})` });
    }
  }

  if (vendor.updatedAt) {
    const d = ageDays(vendor.updatedAt, invoice.date);
    if (d >= 0 && d <= RECENT_CHANGE_DAYS) {
      out.push({ code: 'bank_master_updated_recently', severity: 'warning', message: `Vendor master bank details were updated ${Math.floor(d)} days before this invoice` });
    }
  }
  return out;
}

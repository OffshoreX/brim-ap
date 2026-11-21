import type { Finding } from './types';

// P05 already adds a finance step for these vendors; this makes the reason visible and keeps a vendor on hold from being paid.
export function checkVendorStatus(status: string | null | undefined): Finding[] {
  if (status === 'on_hold') return [{ code: 'vendor_on_hold', severity: 'error', message: 'Vendor is on hold; invoices wait until finance lifts the hold' }];
  if (status === 'pending_review') return [{ code: 'vendor_pending_review', severity: 'warning', message: 'Vendor is pending review; finance approval is added' }];
  return [];
}

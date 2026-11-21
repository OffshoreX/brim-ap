import { describe, expect, it } from 'vitest';
import { checkVendorStatus } from './vendorStatus';

describe('checkVendorStatus', () => {
  it('holds an invoice from a vendor on hold', () => {
    expect(checkVendorStatus('on_hold')).toEqual([expect.objectContaining({ code: 'vendor_on_hold', severity: 'error' })]);
  });
  it('only warns for a vendor pending review', () => {
    expect(checkVendorStatus('pending_review')).toEqual([expect.objectContaining({ code: 'vendor_pending_review', severity: 'warning' })]);
  });
  it('says nothing for active, empty or unknown status', () => {
    for (const s of ['active', '', null, undefined]) expect(checkVendorStatus(s)).toEqual([]);
  });
});

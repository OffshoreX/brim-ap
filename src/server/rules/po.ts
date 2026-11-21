import type { Finding } from './types';

export type PoInvoice = { vendorId: string; totalCents: number };
export type PurchaseOrder = { vendorId: string; totalCents: number; billedCents: number };

// tolerance_bps: 100 = invoice may exceed the PO total by 1%.
export function checkPoMatch(invoice: PoInvoice, po: PurchaseOrder | null | undefined, tolerance_bps: number): Finding[] {
  if (!po) return [{ code: 'po_missing', severity: 'error', message: 'No purchase order for this invoice' }];
  const out: Finding[] = [];
  if (po.vendorId !== invoice.vendorId) {
    out.push({ code: 'po_wrong_vendor', severity: 'error', message: 'Purchase order belongs to a different vendor' });
  }
  if (po.billedCents >= po.totalCents) {
    out.push({ code: 'po_fully_billed', severity: 'error', message: 'Purchase order is already fully billed' });
  }
  // Integer math: total * (10000 + bps) / 10000, compared without dividing.
  if (invoice.totalCents * 10_000 > po.totalCents * (10_000 + tolerance_bps)) {
    out.push({ code: 'po_total_exceeded', severity: 'error', message: 'Invoice total is above the purchase order total beyond tolerance' });
  }
  return out;
}

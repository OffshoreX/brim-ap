import { describe, expect, it } from 'vitest';
import { findSplitInvoices } from './split';
import { checkCreditNote } from './creditnote';

// Test data only: the rules know no vendors, limits or amounts.
const LIMIT = 100000;
const inv = (vendorId: string, totalCents: number, date: string, id?: string) => ({ id, vendorId, totalCents, date });
const codes = (r: { code: string }[]) => r.map((f) => f.code);

describe('findSplitInvoices', () => {
  it('classic split: three under-limit invoices over the limit together', () => {
    const r = findSplitInvoices(inv('v1', 40000, '2026-11-10', 'c'), [inv('v1', 40000, '2026-11-08', 'a'), inv('v1', 30000, '2026-11-09', 'b')], LIMIT, 7);
    expect(codes(r)).toEqual(['POSSIBLE_SPLIT_INVOICE']);
  });
  it('same vendor but spread beyond the window', () => {
    expect(findSplitInvoices(inv('v1', 60000, '2026-11-20'), [inv('v1', 60000, '2026-11-01')], LIMIT, 7)).toEqual([]);
  });
  it('exactly at the window edge still counts', () => {
    expect(codes(findSplitInvoices(inv('v1', 60000, '2026-11-08'), [inv('v1', 60000, '2026-11-01')], LIMIT, 7))).toEqual(['POSSIBLE_SPLIT_INVOICE']);
  });
  it('different vendors are not combined', () => {
    expect(findSplitInvoices(inv('v1', 60000, '2026-11-10'), [inv('v2', 60000, '2026-11-10')], LIMIT, 7)).toEqual([]);
  });
  it('total exactly at the limit is not over it', () => {
    expect(findSplitInvoices(inv('v1', 60000, '2026-11-10'), [inv('v1', 40000, '2026-11-10')], LIMIT, 7)).toEqual([]);
  });
  it('one cent over the limit is flagged', () => {
    expect(codes(findSplitInvoices(inv('v1', 60000, '2026-11-10'), [inv('v1', 40001, '2026-11-10')], LIMIT, 7))).toEqual(['POSSIBLE_SPLIT_INVOICE']);
  });
  it('an invoice already at the limit is not a split', () => {
    expect(findSplitInvoices(inv('v1', 100000, '2026-11-10'), [inv('v1', 5000, '2026-11-10')], LIMIT, 7)).toEqual([]);
  });
  it('a single invoice alone is never a split', () => {
    expect(findSplitInvoices(inv('v1', 90000, '2026-11-10'), [], LIMIT, 7)).toEqual([]);
  });
  it('ignores itself and credit notes in the recent list', () => {
    const self = inv('v1', 60000, '2026-11-10', 'x');
    expect(findSplitInvoices(self, [self, inv('v1', -30000, '2026-11-10', 'cn')], LIMIT, 7)).toEqual([]);
  });
});

describe('checkCreditNote', () => {
  const orig = (creditedCents = 0, vendorId = 'v1') => [{ id: 'o1', vendorId, totalCents: 50000, creditedCents }];
  const note = (totalCents: number, referencesInvoiceId: string | null = 'o1', vendorId = 'v1') => ({ vendorId, totalCents, referencesInvoiceId });

  it('valid partial credit', () => expect(checkCreditNote(note(-20000), orig())).toEqual([]));
  it('valid credit for exactly what is left', () => expect(checkCreditNote(note(-30000), orig(20000))).toEqual([]));
  it('credit over the original', () => expect(codes(checkCreditNote(note(-50001), orig()))).toEqual(['CREDIT_NOTE_EXCEEDS_ORIGINAL']));
  it('credit over what is left after earlier credits', () => expect(codes(checkCreditNote(note(-30001), orig(20000)))).toEqual(['CREDIT_NOTE_EXCEEDS_ORIGINAL']));
  it('no reference', () => expect(codes(checkCreditNote(note(-100, null), orig()))).toEqual(['CREDIT_NOTE_NO_ORIGINAL']));
  it('reference to an unknown invoice', () => expect(codes(checkCreditNote(note(-100, 'zz'), orig()))).toEqual(['CREDIT_NOTE_NO_ORIGINAL']));
  it('original from another vendor', () => expect(codes(checkCreditNote(note(-100, 'o1', 'v2'), orig()))).toEqual(['CREDIT_NOTE_VENDOR_MISMATCH']));
  it('positive or zero total is not a credit note', () => {
    expect(codes(checkCreditNote(note(100), orig()))).toEqual(['NOT_A_CREDIT_NOTE']);
    expect(codes(checkCreditNote(note(0), orig()))).toEqual(['NOT_A_CREDIT_NOTE']);
  });
});

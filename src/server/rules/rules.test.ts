import { describe, expect, it } from 'vitest';
import { checkArithmetic } from './arithmetic';
import { findDuplicates } from './duplicates';
import type { InvoiceKey } from './types';

const base: InvoiceKey = { id: 'a', vendorId: 'v1', number: 'INV-1000', totalCents: 5000, date: '2026-01-10' };
const codes = (f: { code: string }[]) => f.map((x) => x.code);
const incoming = (o: Partial<InvoiceKey>): InvoiceKey => ({ ...base, id: 'new', ...o });

describe('checkArithmetic', () => {
  const L = (...c: number[]) => c.map((totalCents) => ({ totalCents }));
  const T = (...c: number[]) => c.map((amountCents) => ({ amountCents }));
  it('ok when lines + taxes = total', () => expect(checkArithmetic(L(1000, 2000), T(450), 3450)).toEqual([]));
  it('flags mismatch', () => expect(codes(checkArithmetic(L(1000), T(100), 1200))).toEqual(['TOTAL_MISMATCH']));
  it('one cent off is a mismatch by default', () => expect(codes(checkArithmetic(L(1000), T(), 1001))).toEqual(['TOTAL_MISMATCH']));
  it('one cent off passes with tolerance 1', () => expect(checkArithmetic(L(1000), T(), 1001, 1)).toEqual([]));
  it('empty lines flagged', () => expect(codes(checkArithmetic([], T(), 0))).toEqual(['EMPTY_LINES']));
  it('negative credit note adds up', () => expect(checkArithmetic(L(-1000), T(-50), -1050)).toEqual([]));
  it('rejects float cents', () => expect(codes(checkArithmetic(L(10.5), T(), 10.5))).toEqual(['NON_INTEGER_CENTS']));
});

describe('findDuplicates', () => {
  it('exact duplicate', () => expect(codes(findDuplicates(incoming({}), [base]))).toEqual(['DUPLICATE_EXACT']));
  it('case, whitespace and leading-zero variants', () => {
    const ex = { ...base, number: '0042' };
    expect(codes(findDuplicates(incoming({ number: ' 42 ' }), [ex]))).toEqual(['DUPLICATE_EXACT']);
    expect(codes(findDuplicates(incoming({ number: 'inv-1000' }), [base]))).toEqual(['DUPLICATE_EXACT']);
  });
  it('near duplicate by amount and date', () => {
    const f = findDuplicates(incoming({ number: 'ZZZ-9', date: '2026-02-01' }), [base]);
    expect(codes(f)).toEqual(['DUPLICATE_NEAR']);
    expect(f[0].message).toContain('same total');
  });
  it('same total but more than 30 days apart is not a match', () => {
    expect(findDuplicates(incoming({ number: 'ZZZ-9', date: '2026-03-01' }), [base])).toEqual([]);
  });
  it('a close number adds to the reason when the total and date match', () => {
    const f = findDuplicates(incoming({ number: 'INV-1002', date: '2026-01-12' }), [base]);
    expect(f[0].message).toContain('edit distance');
  });
  it('a close number alone, or with the same total a year later, is not a duplicate', () => {
    expect(findDuplicates(incoming({ number: 'INV-1002', totalCents: 1 }), [base])).toEqual([]);
    expect(findDuplicates(incoming({ number: 'INV-1002', date: '2027-01-01' }), [base])).toEqual([]);
  });
  it('a close number with a different total is the next invoice in the sequence, not a duplicate', () => {
    expect(findDuplicates(incoming({ number: '000921', totalCents: 212136 }), [{ ...base, number: '000919', totalCents: 68720 }])).toEqual([]);
  });
  it('a suffixed resubmission with the same total is caught', () => {
    const f = findDuplicates(incoming({ number: '000903-A', date: '2026-07-06', totalCents: 557437 }), [{ ...base, number: '000903', date: '2026-07-04', totalCents: 557437 }]);
    expect(codes(f)).toEqual(['DUPLICATE_NEAR']);
  });
  it('different vendor with the same number is not a duplicate', () => {
    expect(findDuplicates(incoming({ vendorId: 'v2' }), [base])).toEqual([]);
  });
  it('credit note is not a duplicate of its invoice', () => {
    expect(findDuplicates(incoming({ kind: 'credit_note', totalCents: -5000 }), [base])).toEqual([]);
  });
  it('does not match itself', () => expect(findDuplicates(base, [base])).toEqual([]));
});

import { describe, expect, it } from 'vitest';
import { checkTax, expectedTaxCents } from './tax';
import type { TaxCodeRate } from './tax.types';

// Test data only: the rule itself knows no provinces or rates.
const codes: TaxCodeRate[] = [
  { code: 'ON13', province: 'ON', rateBps: 1300 },
  { code: 'QC15', province: 'QC', rateBps: 1498 },
  { code: 'ZERO', province: null, rateBps: 0 },
  { code: 'FIVE', province: null, rateBps: 500 },
];
const line = (amountCents: number, taxCode: string | null) => ({ amountCents, taxCode });
const tax = (lineIndex: number, amountCents: number) => ({ lineIndex, amountCents });
const found = (r: { code: string; lineIndex: number | null }[]) => r.map((f) => `${f.code}@${f.lineIndex}`);

describe('checkTax', () => {
  it('correct tax: no findings', () => {
    expect(checkTax([line(10000, 'ON13')], [tax(0, 1300)], 'ON', codes)).toEqual([]);
  });
  it('wrong province code', () => {
    const r = checkTax([line(10000, 'QC15')], [tax(0, 1498)], 'ON', codes);
    expect(found(r)).toEqual(['WRONG_PROVINCE_CODE@0']);
    expect(r[0].message).toContain('QC');
  });
  it('tax charged on zero-rated', () => {
    expect(found(checkTax([line(10000, 'ZERO')], [tax(0, 500)], 'ON', codes))).toEqual(['TAX_ON_EXEMPT@0']);
  });
  it('zero-rated with no tax is fine', () => {
    expect(checkTax([line(10000, 'ZERO')], [], 'ON', codes)).toEqual([]);
  });
  it('missing tax', () => {
    expect(found(checkTax([line(10000, 'ON13')], [], 'ON', codes))).toEqual(['MISSING_TAX@0']);
  });
  it('rounding at half a cent rounds up', () => {
    // 10 cents * 5% = 0.5 cent -> 1
    expect(expectedTaxCents(10, 500)).toBe(1);
    expect(checkTax([line(10, 'FIVE')], [tax(0, 1)], 'ON', codes)).toEqual([]);
    expect(expectedTaxCents(9, 500)).toBe(0); // 0.45 rounds down
  });
  it('one cent off is tolerated, two is not', () => {
    expect(checkTax([line(10000, 'ON13')], [tax(0, 1301)], 'ON', codes)).toEqual([]);
    expect(found(checkTax([line(10000, 'ON13')], [tax(0, 1302)], 'ON', codes))).toEqual(['TAX_MISMATCH@0']);
  });
  it('two lines, two codes, only the bad one is flagged', () => {
    const r = checkTax([line(10000, 'ON13'), line(2000, 'FIVE')], [tax(0, 1300), tax(1, 100)], 'ON', codes);
    expect(r).toEqual([]);
    expect(found(checkTax([line(10000, 'ON13'), line(2000, 'FIVE')], [tax(0, 1300), tax(1, 10)], 'ON', codes))).toEqual(['TAX_MISMATCH@1']);
  });
  it('several tax rows on one line add up', () => {
    expect(checkTax([line(10000, 'ON13')], [tax(0, 500), tax(0, 800)], 'ON', codes)).toEqual([]);
  });
  it('empty lines: nothing to check', () => {
    expect(checkTax([], [], 'ON', codes)).toEqual([]);
  });
  it('unknown code, and no code', () => {
    expect(found(checkTax([line(100, 'NOPE'), line(100, null)], [], 'ON', codes))).toEqual(['UNKNOWN_TAX_CODE@0', 'UNKNOWN_TAX_CODE@1']);
  });
  it('tax pointing at a missing line is flagged', () => {
    expect(found(checkTax([line(10000, 'ZERO')], [tax(3, 100)], 'ON', codes))).toEqual(['TAX_ON_UNKNOWN_LINE@null']);
  });
  it('credit note line rounds symmetrically', () => {
    expect(expectedTaxCents(-10, 500)).toBe(-1);
    expect(checkTax([line(-10000, 'ON13')], [tax(0, -1300)], 'ON', codes)).toEqual([]);
  });
  it('non-integer cents are rejected', () => {
    expect(found(checkTax([line(10.5, 'ON13')], [], 'ON', codes))).toEqual(['NON_INTEGER_CENTS@null']);
  });
});

import { describe, expect, it } from 'vitest';
import { checkTax, expectedTaxCents, rateToE5, type TaxCodeRate, type TaxLine } from './tax';

// Test rates are parsed from the same decimal strings as tax_codes.csv; the rule knows no rates.
const codes: TaxCodeRate[] = [
  { code: 'HST13', rateE5: rateToE5('0.13'), appliesTo: 'all' },
  { code: 'GST5', rateE5: rateToE5('0.05'), appliesTo: 'all' },
  { code: 'PST7_BC', rateE5: rateToE5('0.07'), appliesTo: 'goods' },
  { code: 'QST9975', rateE5: rateToE5('0.09975'), appliesTo: 'all' },
];
const ln = (amountCents: number, gstHstCode: string | null, pstQstCode: string | null = null, lineType: 'goods' | 'services' = 'services'): TaxLine => ({ amountCents, lineType, gstHstCode, pstQstCode });
const ch = (gstHstCents: number, pstQstCents = 0) => ({ gstHstCents, pstQstCents });
const codesOf = (r: { code: string }[]) => r.map((f) => f.code);

describe('rateToE5 / expectedTaxCents', () => {
  it('converts exactly', () => {
    expect(rateToE5('0.09975')).toBe(9975);
    expect(rateToE5('0.13')).toBe(13000);
    expect(rateToE5('0')).toBe(0);
  });
  it('rounds half a cent away from zero, credit notes mirror', () => {
    expect(expectedTaxCents(10, 5000)).toBe(1); // 0.5 -> 1
    expect(expectedTaxCents(9, 5000)).toBe(0); // 0.45 -> 0
    expect(expectedTaxCents(-10, 5000)).toBe(-1);
  });
});

describe('checkTax', () => {
  it('ON: HST13', () => expect(checkTax([ln(10000, 'HST13')], ch(1300), 'ON', codes)).toEqual([]));
  it('AB: GST5', () => expect(checkTax([ln(10000, 'GST5')], ch(500), 'AB', codes)).toEqual([]));
  it('BC: GST5 + PST on goods', () => expect(checkTax([ln(10000, 'GST5', 'PST7_BC', 'goods')], ch(500, 700), 'BC', codes)).toEqual([]));
  it('BC: services get GST only, no PST', () => expect(checkTax([ln(10000, 'GST5')], ch(500), 'BC', codes)).toEqual([]));
  it('BC: mixed goods and services, PST only on the goods', () => {
    expect(checkTax([ln(10000, 'GST5', 'PST7_BC', 'goods'), ln(20000, 'GST5')], ch(1500, 700), 'BC', codes)).toEqual([]);
  });
  it('BC: PST on a services line is flagged', () => {
    expect(codesOf(checkTax([ln(10000, 'GST5', 'PST7_BC', 'services')], ch(500, 700), 'BC', codes))).toEqual(['PST_ON_SERVICES']);
  });
  it('QC: QST on the pre-tax amount', () => {
    expect(checkTax([ln(10000, 'GST5', 'QST9975')], ch(500, 998), 'QC', codes)).toEqual([]); // 997.5 -> 998
  });
  it('QC: QST computed on the GST-inclusive amount is flagged', () => {
    // 10500 * 9.975% = 1047.4 -> 1047
    expect(codesOf(checkTax([ln(10000, 'GST5', 'QST9975')], ch(500, 1047), 'QC', codes))).toEqual(['QST_ON_GST_INCLUSIVE']);
  });
  it('QC: QST missing is flagged', () => {
    expect(codesOf(checkTax([ln(10000, 'GST5')], ch(500, 0), 'QC', codes))).toEqual(['MISSING_TAX']);
  });
  it('wrong code for the province', () => {
    const r = checkTax([ln(10000, 'HST13')], ch(1300), 'AB', codes);
    expect(codesOf(r)).toEqual(['WRONG_PROVINCE_CODE']);
    expect(r[0].message).toContain('GST5');
  });
  it('exempt line with no tax is fine, with tax is flagged', () => {
    expect(checkTax([ln(10000, 'EXEMPT')], ch(0), 'ON', codes)).toEqual([]);
    expect(codesOf(checkTax([ln(10000, 'EXEMPT')], ch(1300), 'ON', codes))).toEqual(['TAX_ON_EXEMPT']);
  });
  it('foreign vendor: no tax is fine, tax is flagged', () => {
    expect(checkTax([ln(10000, 'FOREIGN')], ch(0), 'BC', codes)).toEqual([]);
    expect(codesOf(checkTax([ln(10000, 'FOREIGN')], ch(500), 'BC', codes))).toEqual(['TAX_ON_EXEMPT']);
  });
  it('exempt line next to a taxable line adds nothing to the base', () => {
    expect(checkTax([ln(10000, 'HST13'), ln(50000, 'EXEMPT')], ch(1300), 'ON', codes)).toEqual([]);
  });
  it('missing tax', () => {
    expect(codesOf(checkTax([ln(10000, 'HST13')], ch(0), 'ON', codes))).toEqual(['MISSING_TAX']);
  });
  it('line with no code in a taxable province is flagged', () => {
    expect(codesOf(checkTax([ln(10000, null)], ch(0), 'ON', codes))).toEqual(['WRONG_PROVINCE_CODE']);
  });
  it('half a cent rounds up on the invoice', () => {
    expect(checkTax([ln(10, 'GST5')], ch(1), 'AB', codes)).toEqual([]);
  });
  it('one cent off is tolerated, two is not', () => {
    expect(checkTax([ln(10000, 'HST13')], ch(1301), 'ON', codes)).toEqual([]);
    expect(codesOf(checkTax([ln(10000, 'HST13')], ch(1302), 'ON', codes))).toEqual(['TAX_MISMATCH']);
  });
  it('unknown code, unknown province, non-integer cents', () => {
    expect(codesOf(checkTax([ln(10000, 'XYZ')], ch(0), 'ON', codes))).toEqual(['UNKNOWN_TAX_CODE']);
    expect(codesOf(checkTax([ln(10000, 'HST13')], ch(1300), 'ZZ', codes))).toEqual(['UNKNOWN_PROVINCE']);
    expect(codesOf(checkTax([ln(100.5, 'HST13')], ch(13), 'ON', codes))).toEqual(['NON_INTEGER_CENTS']);
  });
});

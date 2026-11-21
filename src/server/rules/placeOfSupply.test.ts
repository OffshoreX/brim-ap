import { describe, expect, it } from 'vitest';
import { checkTaxAtSupply, resolveSupply, type SupplyInputs } from './placeOfSupply';
import { rateToE5, type TaxCodeRate, type TaxLine } from './tax';

const codes: TaxCodeRate[] = [
  { code: 'HST13', rateE5: rateToE5('0.13'), appliesTo: 'all' },
  { code: 'GST5', rateE5: rateToE5('0.05'), appliesTo: 'all' },
  { code: 'PST7_BC', rateE5: rateToE5('0.07'), appliesTo: 'goods' },
  { code: 'QST9975', rateE5: rateToE5('0.09975'), appliesTo: 'all' },
];
const ln = (amountCents: number, gstHstCode: string | null, pstQstCode: string | null = null): TaxLine => ({ amountCents, lineType: 'services', gstHstCode, pstQstCode });
const ch = (gstHstCents: number, pstQstCents = 0) => ({ gstHstCents, pstQstCents });
const judge = (lines: TaxLine[], charged: ReturnType<typeof ch>, inputs: SupplyInputs) => checkTaxAtSupply(lines, charged, resolveSupply(inputs), codes);
const one = (r: ReturnType<typeof judge>) => r.findings.map((f) => `${f.severity}:${f.code}`);

describe('resolveSupply', () => {
  it('printed ship-to wins and leaves nothing to guess', () => {
    expect(resolveSupply({ printed: 'qc', requester: 'ON', vendor: 'AB', clerk: 'BC' })).toEqual({ chosen: { province: 'QC', source: 'invoice' }, candidates: [] });
  });
  it('guesses in order: PO requester, requester, vendor; the clerk is never a candidate', () => {
    const r = resolveSupply({ poRequester: 'AB', requester: 'ON', vendor: 'BC', clerk: 'QC' });
    expect(r.chosen).toEqual({ province: 'AB', source: 'po_requester' });
    expect(r.candidates.map((c) => c.source)).toEqual(['po_requester', 'requester', 'vendor']);
  });
  it('skips a requester or vendor province we have no tax rules for, then falls back to the clerk', () => {
    expect(resolveSupply({ requester: 'MB', vendor: 'WA', clerk: 'ON' })).toEqual({ chosen: { province: 'ON', source: 'clerk' }, candidates: [] });
  });
  it('knows nothing: no province at all', () => expect(resolveSupply({})).toEqual({ chosen: null, candidates: [] }));
});

describe('checkTaxAtSupply: guessed place of supply', () => {
  const hst = [ln(10000, 'HST13')];
  const gst = [ln(10000, 'GST5')];

  it('tax fits the first guess: no finding, and the source is kept', () => {
    const r = judge(hst, ch(1300), { requester: 'ON', vendor: 'AB' });
    expect(r.findings).toEqual([]);
    expect(r.supply).toEqual({ province: 'ON', source: 'requester' });
  });
  it('tax fits another candidate (the vendor province): info only, and that province is the one used', () => {
    const r = judge(gst, ch(500), { requester: 'ON', vendor: 'AB' });
    expect(one(r)).toEqual(['info:TAX_MATCHES_OTHER_PROVINCE']);
    expect(r.findings[0].message).toBe('Tax matches the vendor province (AB), delivery unconfirmed');
    expect(r.supply).toEqual({ province: 'AB', source: 'vendor' });
  });
  it('tax is valid somewhere but fits no candidate: a warning that names the source', () => {
    const r = judge(gst, ch(500), { requester: 'ON', vendor: 'ON' });
    expect(one(r)).toEqual(['warning:TAX_PLACE_ASSUMED']);
    expect(r.findings[0].message).toContain('place of supply assumed from requester province (ON)');
  });
  it('the clerk province is a last resort: warning, and not a candidate the tax can match', () => {
    const r = judge(gst, ch(500), { clerk: 'ON' });
    expect(r.findings[0]).toMatchObject({ severity: 'warning', code: 'TAX_PLACE_ASSUMED' });
    expect(r.findings[0].message).toContain('place of supply assumed from AP clerk province (ON)');
    expect(r.supply?.source).toBe('clerk');
  });
  it('no province known at all is still an error', () => {
    expect(one(judge(hst, ch(1300), {}))).toEqual(['error:UNKNOWN_PROVINCE']);
  });
});

// True tax errors must still block: each one is wrong for the province it names, or wrong in every province.
describe('checkTaxAtSupply: true tax errors still block', () => {
  it('wrong rate for the printed province (6% where AB charges 5%)', () => {
    expect(one(judge([ln(10000, 'GST5')], ch(600), { printed: 'AB', requester: 'ON' }))).toEqual(['error:TAX_MISMATCH']);
  });
  it('wrong rate with no ship-to: 12% fits no province, so it stays an error', () => {
    expect(one(judge([ln(10000, 'HST13')], ch(1200), { requester: 'ON', vendor: 'ON' }))).toEqual(['error:TAX_MISMATCH']);
  });
  it('QST charged on the GST-inclusive base stays an error even with no ship-to', () => {
    // 10500 * 9.975% = 1047.4 -> 1047, instead of 998 on the pre-tax amount
    const r = judge([ln(10000, 'GST5', 'QST9975')], ch(500, 1047), { requester: 'QC', vendor: 'ON' });
    expect(one(r)).toEqual(['error:QST_ON_GST_INCLUSIVE']);
  });
  it('GST only where HST is due: an error when the invoice names Ontario', () => {
    expect(one(judge([ln(10000, 'GST5')], ch(500), { printed: 'ON', vendor: 'AB' }))).toEqual(['error:WRONG_PROVINCE_CODE']);
  });
  it('tax on an exempt line (insurance) stays an error in every province', () => {
    expect(one(judge([ln(10000, 'EXEMPT')], ch(500), { requester: 'ON', vendor: 'AB' }))).toEqual(['error:TAX_ON_EXEMPT']);
    expect(one(judge([ln(10000, 'EXEMPT')], ch(500), { printed: 'ON' }))).toEqual(['error:TAX_ON_EXEMPT']);
  });
  it('a printed ship-to we have no rules for is an error, not a guess', () => {
    expect(one(judge([ln(10000, 'HST13')], ch(1300), { printed: 'MB', requester: 'ON' }))).toEqual(['error:UNKNOWN_PROVINCE']);
  });
});

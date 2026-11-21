import { describe, expect, it } from 'vitest';
import { checkContractPrice } from './contract';
import { checkPoMatch } from './po';
import { convertCents } from './fx';

const contracts = [{ sku: 'A', unitPriceCents: 1000, validFrom: '2026-01-01', validTo: '2026-06-30' }];
const codes = (r: { code: string }[]) => r.map((f) => f.code);

describe('checkContractPrice', () => {
  it('at contract price: no flag', () => {
    expect(checkContractPrice([{ sku: 'A', unitPriceCents: 1000 }], contracts, '2026-03-01')).toEqual([]);
  });
  it('one cent above: flags and says by how much', () => {
    const r = checkContractPrice([{ sku: 'A', unitPriceCents: 1001 }], contracts, '2026-03-01');
    expect(codes(r)).toEqual(['contract_price_exceeded']);
    expect(r[0].message).toContain('1 cents');
  });
  it('below contract price: no flag', () => {
    expect(checkContractPrice([{ sku: 'A', unitPriceCents: 900 }], contracts, '2026-03-01')).toEqual([]);
  });
  it('expired contract: not compared', () => {
    expect(checkContractPrice([{ sku: 'A', unitPriceCents: 5000 }], contracts, '2026-07-01')).toEqual([]);
  });
  it('end date is inclusive', () => {
    expect(codes(checkContractPrice([{ sku: 'A', unitPriceCents: 2000 }], contracts, '2026-06-30'))).toEqual(['contract_price_exceeded']);
  });
});

describe('checkPoMatch', () => {
  const po = { vendorId: 'v1', totalCents: 100_000, billedCents: 0 };
  it('no PO', () => {
    expect(codes(checkPoMatch({ vendorId: 'v1', totalCents: 1 }, null, 0))).toEqual(['po_missing']);
  });
  it('wrong vendor PO', () => {
    expect(codes(checkPoMatch({ vendorId: 'v2', totalCents: 100 }, po, 0))).toEqual(['po_wrong_vendor']);
  });
  it('within tolerance', () => {
    expect(checkPoMatch({ vendorId: 'v1', totalCents: 101_000 }, po, 100)).toEqual([]);
  });
  it('one cent over tolerance', () => {
    expect(codes(checkPoMatch({ vendorId: 'v1', totalCents: 101_001 }, po, 100))).toEqual(['po_total_exceeded']);
  });
  it('already fully billed', () => {
    expect(codes(checkPoMatch({ vendorId: 'v1', totalCents: 100 }, { ...po, billedCents: 100_000 }, 0))).toEqual(['po_fully_billed']);
  });
});

describe('convertCents', () => {
  const usdCad = { from: 'USD', to: 'CAD', rateBps: 13_500 };
  it('USD to CAD', () => expect(convertCents(10_000, 'USD', 'CAD', usdCad)).toBe(13_500));
  it('rounds half up', () => expect(convertCents(1, 'USD', 'CAD', { ...usdCad, rateBps: 5_000 })).toBe(1)); // 0.5 -> 1
  it('rounds down below half', () => expect(convertCents(1, 'USD', 'CAD', { ...usdCad, rateBps: 4_999 })).toBe(0));
  it('same currency: unchanged', () => expect(convertCents(123, 'CAD', 'CAD', undefined)).toBe(123));
  it('unknown pair is refused', () => {
    expect(() => convertCents(100, 'USD', 'EUR', usdCad)).toThrow();
    expect(() => convertCents(100, 'USD', 'EUR', undefined)).toThrow();
  });
  it('negative amounts mirror positive', () => expect(convertCents(-1, 'USD', 'CAD', { ...usdCad, rateBps: 5_000 })).toBe(-1));
});

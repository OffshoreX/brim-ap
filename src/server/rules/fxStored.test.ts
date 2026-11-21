import { describe, expect, it } from 'vitest';
import { checkStoredFx } from './fx';

const usd = { currency: 'USD', totalCents: 100_000, totalCadCents: 135_000, rateBps: 13_500 };

describe('checkStoredFx', () => {
  it('accepts a USD invoice at the table rate', () => expect(checkStoredFx(usd, 13_500)).toEqual([]));
  it('accepts a CAD invoice whose CAD total equals its total', () => {
    expect(checkStoredFx({ currency: 'CAD', totalCents: 5_000, totalCadCents: 5_000, rateBps: 10_000 }, undefined)).toEqual([]);
  });
  it('flags an invoice rate that is not the table rate', () => {
    expect(checkStoredFx({ ...usd, rateBps: 13_000, totalCadCents: 130_000 }, 13_500).map((f) => f.code)).toEqual(['fx_rate_mismatch', 'fx_total_cad_mismatch']);
  });
  it('flags a CAD total that does not follow from the rate, but not a one-cent rounding gap', () => {
    expect(checkStoredFx({ ...usd, totalCadCents: 140_000 }, 13_500).map((f) => f.code)).toEqual(['fx_total_cad_mismatch']);
    expect(checkStoredFx({ ...usd, totalCadCents: 135_001 }, 13_500)).toEqual([]);
  });
  it('refuses to judge a USD invoice on a day with no table rate', () => {
    expect(checkStoredFx(usd, undefined).map((f) => f.code)).toEqual(['fx_rate_missing']);
  });
});

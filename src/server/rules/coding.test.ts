import { describe, expect, it } from 'vitest';
import { suggestCoding } from './coding';
import type { CodedInvoice } from './types';

const h = (vendorId: string, accountCode: string, taxCode: string, n = 1): CodedInvoice[] =>
  Array.from({ length: n }, () => ({ vendorId, accountCode, taxCode }));

describe('suggestCoding', () => {
  it('picks the clear winner with a reason and confidence', () => {
    const r = suggestCoding('v1', [...h('v1', 'A', 'T', 14), ...h('v1', 'B', 'T')]);
    expect(r).toMatchObject({ status: 'suggested', accountCode: 'A', taxCode: 'T' });
    if (r.status === 'suggested') {
      expect(r.reason).toContain('14 of 15');
      expect(r.confidence).toBeCloseTo(14 / 15);
    }
  });
  it('picks account and tax code independently', () => {
    const r = suggestCoding('v1', [...h('v1', 'A', 'T1', 1), ...h('v1', 'A', 'T2', 1), ...h('v1', 'B', 'T2', 1)]);
    expect(r).toMatchObject({ accountCode: 'A', taxCode: 'T2' });
  });
  it('returns none on a tie', () => {
    expect(suggestCoding('v1', [...h('v1', 'A', 'T', 2), ...h('v1', 'B', 'T', 2)]).status).toBe('none');
  });
  it('returns none with too little history', () => {
    expect(suggestCoding('v1', h('v1', 'A', 'T', 2)).status).toBe('none');
  });
  it('returns none for an unknown vendor', () => {
    expect(suggestCoding('nobody', h('v1', 'A', 'T', 10)).status).toBe('none');
  });
  it('does not mix vendors', () => {
    const hist = [...h('v1', 'A', 'T', 3), ...h('v2', 'B', 'U', 5)];
    expect(suggestCoding('v1', hist)).toMatchObject({ accountCode: 'A', taxCode: 'T' });
    expect(suggestCoding('v2', hist)).toMatchObject({ accountCode: 'B', taxCode: 'U' });
  });
  it('returns none for empty history', () => {
    expect(suggestCoding('v1', []).status).toBe('none');
  });
});

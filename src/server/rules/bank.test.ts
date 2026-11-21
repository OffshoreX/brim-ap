import { describe, expect, it } from 'vitest';
import { checkBankChange } from './bank';

const A = { accountNumber: '1234 5678', routingNumber: '021-000-021' };
const B = { accountNumber: '9999 0000', routingNumber: '011-000-015' };
const today = '2026-11-20';
const codes = (r: { code: string }[]) => r.map((f) => f.code);

describe('checkBankChange', () => {
  it('same details: no flags', () => {
    expect(checkBankChange(A, [{ ...A, since: '2025-01-01' }], today)).toEqual([]);
  });
  it('formatting differences are not a change', () => {
    const inv = { accountNumber: '12345678', routingNumber: '021000021' };
    expect(checkBankChange(inv, [{ ...A, since: '2025-01-01' }], today)).toEqual([]);
  });
  it('different account number only is a change', () => {
    const inv = { ...A, accountNumber: '1234 5679' };
    expect(codes(checkBankChange(inv, [{ ...A, since: '2025-01-01' }], today))).toContain('bank_differs_from_latest');
  });
  it('changed and never seen', () => {
    const r = checkBankChange(B, [{ ...A, since: '2025-01-01' }], today);
    expect(codes(r)).toEqual(['bank_differs_from_latest', 'bank_never_seen']);
  });
  it('reverting to older known details differs but is not never-seen', () => {
    const h = [{ ...A, since: '2025-01-01' }, { ...B, since: '2025-06-01' }];
    expect(codes(checkBankChange(A, h, today))).toEqual(['bank_differs_from_latest']);
  });
  it('changed recently (within 30 days)', () => {
    const h = [{ ...A, since: '2025-01-01' }, { ...B, since: '2026-11-01' }];
    expect(codes(checkBankChange(B, h, today))).toEqual(['bank_changed_recently']);
  });
  it('change older than 30 days is not recent', () => {
    const h = [{ ...A, since: '2025-01-01' }, { ...B, since: '2026-10-01' }];
    expect(checkBankChange(B, h, today)).toEqual([]);
  });
  it('first-ever record is not a change even if new', () => {
    expect(checkBankChange(A, [{ ...A, since: '2026-11-15' }], today)).toEqual([]);
  });
  it('vendor with no history', () => {
    expect(codes(checkBankChange(A, [], today))).toEqual(['bank_no_history']);
  });
  it('history order does not matter', () => {
    const h = [{ ...B, since: '2025-06-01' }, { ...A, since: '2025-01-01' }];
    expect(checkBankChange(B, h, today)).toEqual([]);
  });
});

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

// ---- checkVendorBankRisk (T29) ----
import { readFileSync } from 'node:fs';
import { checkVendorBankRisk, type BankChangeRow } from './bank';

const master = { institution: '003', transit: '92968', account: '953389679' };
const inv = { ...master, date: '2026-11-02' };
const ch = (o: Partial<BankChangeRow> = {}): BankChangeRow => ({
  changedAt: '2026-01-01', channel: 'vendor_portal', verifiedByCallback: true, oldLast4: '7504', newLast4: '9679', ...o,
});
const risk = (i = inv, v: object = master, c: BankChangeRow[] = [], t = '2026-11-02') =>
  codes(checkVendorBankRisk(i, v as typeof master, c, t));

describe('checkVendorBankRisk', () => {
  it('matching master and no history: clean', () => expect(risk()).toEqual([]));
  it('formatting differences are not a mismatch', () =>
    expect(risk({ ...inv, account: '95338-9679', transit: '92 968' })).toEqual([]));
  it('different account is an error', () =>
    expect(risk({ ...inv, account: '111111111' })).toEqual(['bank_differs_from_master']));
  it('different transit only is an error', () =>
    expect(risk({ ...inv, transit: '00000' })).toEqual(['bank_differs_from_master']));
  it('different institution only is an error', () =>
    expect(risk({ ...inv, institution: '999' })).toEqual(['bank_differs_from_master']));
  it('reason says stale when invoice matches the old last4', () => {
    const f = checkVendorBankRisk({ ...inv, account: '000007504' }, master, [ch()], '2026-11-02');
    expect(f[0].message).toContain('replaced');
  });
  it('reason says unknown when last4 is in no history row', () => {
    const f = checkVendorBankRisk({ ...inv, account: '000001234' }, master, [ch()], '2026-11-02');
    expect(f[0].message).toContain('no account in the change history');
  });
  it('unverified (callback no) is an error', () =>
    expect(risk(inv, master, [ch({ verifiedByCallback: false })])).toEqual(['bank_change_unverified']));
  it('email request is an error even if marked verified', () =>
    expect(risk(inv, master, [ch({ channel: 'email_request' })])).toEqual(['bank_change_unverified']));
  it('verified portal change older than 30 days is clean', () => expect(risk(inv, master, [ch()])).toEqual([]));
  it('change within 30 days is a warning', () =>
    expect(risk(inv, master, [ch({ changedAt: '2026-10-20' })])).toEqual(['bank_changed_recently']));
  it('change exactly 31 days ago is not recent', () =>
    expect(risk(inv, master, [ch({ changedAt: '2026-10-02' })])).toEqual([]));
  it('master updated within 30 days of invoice date is a warning', () =>
    expect(risk(inv, { ...master, updatedAt: '2026-10-25' })).toEqual(['bank_master_updated_recently']));
  it('master updated after the invoice date is not flagged', () =>
    expect(risk(inv, { ...master, updatedAt: '2026-11-10' })).toEqual([]));
  it('unverified, recent and mismatched together', () =>
    expect(risk({ ...inv, account: '000007504' }, master, [ch({ changedAt: '2026-10-27', channel: 'email_request', verifiedByCallback: false })])).toEqual([
      'bank_differs_from_master', 'bank_change_unverified', 'bank_changed_recently',
    ]));

  // Real dataset: the latest change that was unverified and by email must be flagged (no vendor id hardcoded).
  it('flags the dataset change that was emailed and unverified', () => {
    const rows = readFileSync('brim_ap_dataset/data/bank_change_history.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
    const bad = rows.find((r) => r[4] === 'email_request' && r[5] === 'no')!;
    const f = checkVendorBankRisk(inv, master, [ch({ changedAt: bad[2], channel: bad[4], verifiedByCallback: false, oldLast4: bad[6], newLast4: bad[7] })], bad[2]);
    expect(codes(f)).toEqual(['bank_change_unverified', 'bank_changed_recently']);
  });
});

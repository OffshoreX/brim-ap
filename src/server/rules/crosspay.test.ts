import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findCrossPayments, nameMatches, normalizeName } from './crosspay';

const vendor = { id: 'V1', legalName: 'Tessera Analytics Inc.' };
const inv = { id: 'AP-9', vendorId: 'V1', totalCents: 150000, date: '2026-03-10' };
const card = (o = {}) => ({ id: 'CT-1', merchant: 'TESSERA ANALYTICS INC.', amountCadCents: 150000, date: '2026-03-12', ...o });
const bank = (o = {}) => ({ id: 'BK-1', description: 'EFT PMT TESSERA ANALYTICS INC. 123456', debitCents: 150000, date: '2026-03-20', ...o });
const pay = (o = {}) => ({ id: 'PAY-1', invoiceId: 'AP-1', vendorId: 'V1', amountCents: 150000, ...o });
const codes = (r: { code: string }[]) => r.map((f) => f.code);
const run = (c: unknown[] = [], b: unknown[] = [], p: unknown[] = []) =>
  findCrossPayments(inv, vendor, c as never, b as never, p as never);

describe('name matching', () => {
  it('ignores case, punctuation and suffixes', () => {
    expect(normalizeName('Tessera Analytics, INC.')).toBe(normalizeName('tessera analytics ltd'));
  });
  it('accepts a truncated prefix, rejects a different vendor', () => {
    expect(nameMatches('VOYAGEUR CORPORATE TRA', 'Voyageur Corporate Travel Ltd.')).toBe(true);
    expect(nameMatches('Polar Freight Lines Ltd.', 'Polar Freight Services Ltd.')).toBe(false);
  });
  it('short text is not trusted as a prefix', () => {
    expect(nameMatches('TESS', vendor.legalName)).toBe(false);
  });
});

describe('findCrossPayments', () => {
  it('matched by card', () => expect(codes(run([card()]))).toEqual(['cross_paid_card']));
  it('card amount within 1 cent matches', () => expect(codes(run([card({ amountCadCents: 150001 })]))).toEqual(['cross_paid_card']));
  it('card with truncated descriptor matches', () => {
    expect(codes(run([card({ merchant: 'TESSERA ANALYTICS INC' })]))).toEqual(['cross_paid_card']);
  });
  it('matched by bank', () => expect(codes(run([], [bank()]))).toEqual(['cross_paid_bank']));
  it('matched by existing payment', () => expect(codes(run([], [], [pay()]))).toEqual(['cross_paid_payment']));
  it('card: different amount', () => expect(run([card({ amountCadCents: 150100 })])).toEqual([]));
  it('card: dates far apart', () => expect(run([card({ date: '2026-04-01' })])).toEqual([]));
  it('card: date exactly 14 days apart still matches', () => {
    expect(codes(run([card({ date: '2026-03-24' })]))).toEqual(['cross_paid_card']);
  });
  it('bank: different amount', () => expect(run([], [bank({ debitCents: 149999 })])).toEqual([]));
  it('card and bank: similar name, different vendor', () => {
    expect(run([card({ merchant: 'TESSERA ANALYTICS GROUP' })], [bank({ description: 'EFT PMT TESSERA ANALYTICS GROUP 1' })])).toEqual([]);
  });
  it('payment: other vendor or other amount', () => {
    expect(run([], [], [pay({ vendorId: 'V2' }), pay({ amountCents: 1 })])).toEqual([]);
  });
  it("payment: the invoice's own row is not a second payment", () => {
    expect(run([], [], [pay({ invoiceId: 'AP-9' })])).toEqual([]);
  });
  it('no match at all', () => expect(run([card({ merchant: 'ROADHOUSE GRILL' })], [bank({ description: 'MONTHLY ACCOUNT FEE' })], [])).toEqual([]));
  it('all three can fire together', () => expect(codes(run([card()], [bank()], [pay()]))).toHaveLength(3));
});

// Reads the real dataset so the truncated-text handling is checked against real rows.
describe('real dataset', () => {
  const dir = join(__dirname, '../../../brim_ap_dataset/data');
  const rows = (f: string) => readFileSync(join(dir, f), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  it('every bank EFT line resolves to exactly one vendor name', () => {
    const vendors = readFileSync(join(dir, 'vendors.csv'), 'utf8').trim().split('\n').slice(1)
      .map((l) => (l.match(/^[^,]*,([^,]*)/) as RegExpMatchArray)[1]);
    for (const [, , desc] of rows('bank_statement.csv').filter((r) => r[2].startsWith('EFT PMT'))) {
      const hits = new Set(vendors.filter((v) => nameMatches(desc.replace(/^EFT PMT /, '').replace(/\s+\d+$/, ''), v)).map(normalizeName));
      expect(hits.size, desc).toBe(1);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { codeLine, similarity } from './coding';
import type { CodedLine } from './types';

const h = (invoiceId: number, description: string, accountCode: string): CodedLine => ({ invoiceId, description, accountCode });

describe('similarity', () => {
  it('ignores digits and case', () => expect(similarity('Fuel surcharge 12%', 'FUEL SURCHARGE 11%')).toBe(1));
  it('is 0 for unrelated text and for text with no words', () => {
    expect(similarity('Freight', 'Fuel surcharge')).toBe(0);
    expect(similarity('123', '456')).toBe(0);
  });
});

describe('codeLine fallback order', () => {
  it('(a) uses past lines with a similar description, even with little history', () => {
    const r = codeLine('Fuel surcharge 14%', [h(1, 'Fuel surcharge 12%', '5020'), h(1, 'Freight Toronto', '5010')], '5099');
    expect(r).toMatchObject({ status: 'coded', source: 'history_description', accountCode: '5020' });
    expect(r.reason).toContain('similar description');
  });
  it('(a) different lines of one vendor get different accounts', () => {
    const history = [h(1, 'Fuel surcharge', '5020'), h(1, 'Linehaul freight', '5010')];
    expect(codeLine('Fuel surcharge 9%', history, null)).toMatchObject({ accountCode: '5020' });
    expect(codeLine('Linehaul freight Hamilton', history, null)).toMatchObject({ accountCode: '5010' });
  });
  it('(b) with no similar line, uses the most used account once there are 3 past invoices', () => {
    const history = [h(1, 'Alpha', '5010'), h(2, 'Beta', '5010'), h(3, 'Gamma', '5020')];
    expect(codeLine('Something new', history, '5099')).toMatchObject({ source: 'history_overall', accountCode: '5010' });
  });
  it('(b) is skipped with fewer than 3 past invoices: falls to the vendor default', () => {
    const r = codeLine('Something new', [h(1, 'Alpha', '5010'), h(2, 'Beta', '5010')], '5099');
    expect(r).toMatchObject({ source: 'vendor_default', accountCode: '5099' });
    expect(r.reason).toContain('only 2 past invoices');
  });
  it('(b) tie in history falls to the vendor default, never a silent pick', () => {
    const history = [h(1, 'Alpha', '5010'), h(2, 'Beta', '5020'), h(3, 'Gamma', '5010'), h(4, 'Delta', '5020')];
    expect(codeLine('Something new', history, '5099')).toMatchObject({ source: 'vendor_default' });
    expect(codeLine('Something new', history, null)).toMatchObject({ status: 'coding_needed' });
  });
  it('(c) new vendor with a default account uses it, with a reason', () => {
    const r = codeLine('Anything', [], '6110');
    expect(r).toMatchObject({ status: 'coded', source: 'vendor_default', accountCode: '6110' });
    expect(r.reason).toContain('vendor default');
  });
  it('(d) nothing to go on: coding_needed with a reason', () => {
    expect(codeLine('Anything', [], null)).toMatchObject({ status: 'coding_needed' });
  });
});

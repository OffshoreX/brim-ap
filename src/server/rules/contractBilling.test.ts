import { describe, expect, it } from 'vitest';
import { billingLines } from '../pipeline';
import { checkContractByBilling, type BillingContract, type BillingInvoice, type RateFor } from './contract';

const base: Omit<BillingContract, 'billingType'> = { currency: 'CAD', startDate: '2026-01-01', endDate: '2026-12-31' };
const inv = (o: Partial<BillingInvoice> = {}): BillingInvoice => ({ date: '2026-03-10', currency: 'CAD', subtotalCents: 240_000, lines: [], ...o });
const noFx: RateFor = () => undefined;
const usdToCad: RateFor = () => ({ from: 'USD', to: 'CAD', rateBps: 13_500 }); // 1.35
const codes = (r: { code: string }[]) => r.map((f) => f.code);
const run = (i: BillingInvoice, c: BillingContract | null, prior: { date: string; currency: string; subtotalCents: number }[] = [], fx: RateFor = noFx) =>
  codes(checkContractByBilling(i, c, prior, fx));

const fixed: BillingContract = { ...base, billingType: 'fixed_monthly', monthlyFeeCents: 240_000 };
const rate: BillingContract = { ...base, billingType: 'rate_card', fuelSurchargeCapBps: 1200, hourlyRateCapCents: 24_500, notToExceedMonthlyCents: 2_800_000 };

describe('checkContractByBilling', () => {
  it('fixed_monthly: subtotal equals the fee passes', () => expect(run(inv(), fixed)).toEqual([]));
  it('fixed_monthly: any other subtotal fails', () => expect(run(inv({ subtotalCents: 240_001 }), fixed)).toEqual(['contract_fee_mismatch']));
  it('rate_card: fuel surcharge at the cap passes', () => {
    const lines = [{ kind: 'other' as const, amountCents: 100_000 }, { kind: 'fuel_surcharge' as const, amountCents: 12_000 }];
    expect(run(inv({ subtotalCents: 112_000, lines }), rate)).toEqual([]);
  });
  it('rate_card: fuel surcharge over the cap fails', () => {
    const lines = [{ kind: 'other' as const, amountCents: 100_000 }, { kind: 'fuel_surcharge' as const, amountCents: 12_001 }];
    expect(run(inv({ subtotalCents: 112_001, lines }), rate)).toEqual(['contract_fuel_surcharge_exceeded']);
  });
  it('rate_card: hourly rate at the cap passes', () => {
    expect(run(inv({ subtotalCents: 24_500, lines: [{ kind: 'hourly', amountCents: 24_500, unitPriceCents: 24_500 }] }), rate)).toEqual([]);
  });
  it('rate_card: hourly rate over the cap fails', () => {
    expect(run(inv({ subtotalCents: 24_600, lines: [{ kind: 'hourly', amountCents: 24_600, unitPriceCents: 24_600 }] }), rate)).toEqual(['contract_hourly_rate_exceeded']);
  });
  it('rate_card: month-to-date under the NTE passes', () => {
    expect(run(inv({ subtotalCents: 1_000_000 }), rate, [{ date: '2026-03-02', currency: 'CAD', subtotalCents: 1_800_000 }])).toEqual([]);
  });
  it('rate_card: month-to-date over the NTE fails', () => {
    expect(run(inv({ subtotalCents: 1_000_001 }), rate, [{ date: '2026-03-02', currency: 'CAD', subtotalCents: 1_800_000 }])).toEqual(['contract_nte_exceeded']);
  });
  it('blanket: only the NTE applies, pass and fail', () => {
    const c: BillingContract = { ...base, billingType: 'blanket', notToExceedMonthlyCents: 900_000 };
    expect(run(inv({ subtotalCents: 900_000 }), c)).toEqual([]);
    expect(run(inv({ subtotalCents: 900_001 }), c)).toEqual(['contract_nte_exceeded']);
  });
  it('retainer: hourly cap and NTE both apply', () => {
    const c: BillingContract = { ...base, billingType: 'retainer', hourlyRateCapCents: 52_000, notToExceedMonthlyCents: 2_000_000 };
    const line = { kind: 'hourly' as const, amountCents: 100_000, unitPriceCents: 52_001 };
    expect(run(inv({ subtotalCents: 100_000, lines: [line] }), c)).toEqual(['contract_hourly_rate_exceeded']);
    expect(run(inv({ subtotalCents: 100_000, lines: [{ ...line, unitPriceCents: 52_000 }] }), c)).toEqual([]);
  });
  it('expired status is flagged even inside the dates', () => {
    expect(run(inv(), { ...fixed, status: 'expired' })).toEqual(['contract_expired']);
  });
  it('invoice dated after the contract end is flagged', () => {
    expect(run(inv({ date: '2027-01-01' }), fixed)).toEqual(['contract_expired']);
  });
  it('no contract is flagged', () => expect(run(inv(), null)).toEqual(['contract_missing']));
  it('USD invoice against a CAD contract is compared after conversion', () => {
    // 1777.78 USD * 1.35 = 2400.00 CAD (rounded half up) equals the fee.
    expect(run(inv({ currency: 'USD', subtotalCents: 177_778 }), fixed, [], usdToCad)).toEqual([]);
    expect(run(inv({ currency: 'USD', subtotalCents: 240_000 }), fixed, [], usdToCad)).toEqual(['contract_fee_mismatch']);
  });
  it('USD invoice with no rate is flagged, not guessed', () => {
    expect(run(inv({ currency: 'USD' }), fixed)).toEqual(['contract_fx_unknown']);
  });
});

describe('billingLines', () => {
  const kind = (description: string) => billingLines([{ description, amountCents: 1, unitPriceCents: 1 }])[0].kind;
  it('hours and legal-services lines are hourly, fuel is fuel, the rest is other', () => {
    expect([kind('Tax advisory hours'), kind('Legal services - Lease amendment'), kind('Fuel surcharge (9.88%)'), kind('LTL shipment Regina-Hamilton')]).toEqual(['hourly', 'hourly', 'fuel_surcharge', 'other']);
  });
  it('a legal-services line over the retainer hourly cap is caught', () => {
    const retainer: BillingContract = { ...base, billingType: 'retainer', hourlyRateCapCents: 52_000 };
    const lines = billingLines([{ description: 'Legal services - Lease amendment', amountCents: 36 * 60_000, unitPriceCents: 60_000 }]);
    expect(run(inv({ subtotalCents: 36 * 60_000, lines }), retainer)).toEqual(['contract_hourly_rate_exceeded']);
  });
});

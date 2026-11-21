import { convertCents, type FxRate } from './fx';
import type { Finding } from './types';

export type PricedLine = { sku: string; unitPriceCents: number };
// A contract price is valid from `validFrom` to `validTo` inclusive (ISO yyyy-mm-dd).
export type Contract = { sku: string; unitPriceCents: number; validFrom: string; validTo: string };

// ISO dates compare correctly as strings.
export function checkContractPrice(lines: PricedLine[], contracts: Contract[], invoiceDate: string): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    const c = contracts.find((k) => k.sku === l.sku && k.validFrom <= invoiceDate && invoiceDate <= k.validTo);
    if (!c) continue; // no contract valid on that date: nothing to compare against
    const over = l.unitPriceCents - c.unitPriceCents;
    if (over > 0) {
      out.push({
        code: 'contract_price_exceeded',
        severity: 'error',
        message: `${l.sku}: unit price is ${over} cents above the contract price`,
      });
    }
  }
  return out;
}

// ---- Contract check by billing type (T28). Money is integer cents; rates are basis points. ----

export type BillingType = 'fixed_monthly' | 'rate_card' | 'blanket' | 'retainer';
// Optional fields mirror the empty columns in contracts.csv: a rule only runs when its field is set.
export type BillingContract = {
  billingType: BillingType;
  currency: string;
  startDate: string;
  endDate: string;
  status?: string; // 'expired' in the data wins over the dates
  monthlyFeeCents?: number;
  hourlyRateCapCents?: number;
  fuelSurchargeCapBps?: number; // 12% -> 1200
  notToExceedMonthlyCents?: number;
};
// `kind` is decided by the caller (the line's description), never guessed here.
export type BillingLine = { kind: 'fuel_surcharge' | 'hourly' | 'other'; amountCents: number; unitPriceCents?: number };
export type BillingInvoice = { date: string; currency: string; subtotalCents: number; lines: BillingLine[] };
// Same vendor and contract, earlier invoices in the same calendar month (caller filters).
export type MonthInvoice = { date: string; currency: string; subtotalCents: number };
export type RateFor = (from: string, to: string, date: string) => FxRate | undefined;

const err = (code: string, message: string): Finding => ({ code, severity: 'error', message });

export function checkContractByBilling(
  invoice: BillingInvoice,
  contract: BillingContract | null | undefined,
  monthToDate: MonthInvoice[],
  rateFor: RateFor,
): Finding[] {
  if (!contract) return [err('contract_missing', 'No contract for this vendor')];
  if (contract.status === 'expired' || invoice.date < contract.startDate || invoice.date > contract.endDate) {
    return [err('contract_expired', 'Contract is expired or not valid on the invoice date')];
  }
  const cur = contract.currency;
  // An unknown currency pair throws; surface it as a finding instead of guessing a rate.
  const conv = (cents: number, from: string, date: string) => convertCents(cents, from, cur, rateFor(from, cur, date));
  try {
    const out: Finding[] = [];
    const subtotal = conv(invoice.subtotalCents, invoice.currency, invoice.date);

    if (contract.billingType === 'fixed_monthly' && contract.monthlyFeeCents !== undefined && subtotal !== contract.monthlyFeeCents) {
      out.push(err('contract_fee_mismatch', `Subtotal ${subtotal} differs from the monthly fee ${contract.monthlyFeeCents}`));
    }
    const cap = contract.fuelSurchargeCapBps;
    if (cap !== undefined) {
      const sum = (pred: (l: BillingLine) => boolean) => invoice.lines.filter(pred).reduce((s, l) => s + l.amountCents, 0);
      const fuel = sum((l) => l.kind === 'fuel_surcharge');
      const base = sum((l) => l.kind !== 'fuel_surcharge');
      if (fuel * 10_000 > cap * base) out.push(err('contract_fuel_surcharge_exceeded', 'Fuel surcharge is above the contract cap of the base amount'));
    }
    const hourlyCap = contract.hourlyRateCapCents;
    if (hourlyCap !== undefined) {
      for (const l of invoice.lines) {
        if (l.kind === 'hourly' && l.unitPriceCents !== undefined && conv(l.unitPriceCents, invoice.currency, invoice.date) > hourlyCap) {
          out.push(err('contract_hourly_rate_exceeded', 'Hourly rate is above the contract cap'));
        }
      }
    }
    const nte = contract.notToExceedMonthlyCents;
    if (nte !== undefined) {
      const prior = monthToDate.reduce((s, m) => s + conv(m.subtotalCents, m.currency, m.date), 0);
      if (prior + subtotal > nte) out.push(err('contract_nte_exceeded', 'Month-to-date billing is above the contract not-to-exceed'));
    }
    return out;
  } catch (e) {
    return [err('contract_fx_unknown', e instanceof Error ? e.message : 'Cannot convert currency')];
  }
}

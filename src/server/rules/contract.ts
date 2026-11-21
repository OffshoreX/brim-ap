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

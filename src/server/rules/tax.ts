import type { InvoiceTax, TaxCodeRate, TaxFinding, TaxLine } from './tax.types';

const TOLERANCE_CENTS = 1;

// Integer math: round half away from zero, so a credit note rounds like the invoice it reverses.
export function expectedTaxCents(amountCents: number, rateBps: number): number {
  const sign = amountCents < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(amountCents) * rateBps + 5000) / 10000);
}

export function checkTax(
  lines: TaxLine[],
  invoiceTaxes: InvoiceTax[],
  deliveryProvince: string,
  taxCodes: TaxCodeRate[],
): TaxFinding[] {
  const bad = (lineIndex: number | null, code: string, message: string): TaxFinding => ({
    code,
    message,
    severity: 'error',
    lineIndex,
  });
  const nums = [...lines.map((l) => l.amountCents), ...invoiceTaxes.map((t) => t.amountCents)];
  if (!nums.every(Number.isSafeInteger)) return [bad(null, 'NON_INTEGER_CENTS', 'All amounts must be integer cents')];

  const findings: TaxFinding[] = [];
  const charged = lines.map(() => 0);
  for (const t of invoiceTaxes) {
    if (!Number.isInteger(t.lineIndex) || t.lineIndex < 0 || t.lineIndex >= lines.length) {
      findings.push(bad(null, 'TAX_ON_UNKNOWN_LINE', `Tax of ${t.amountCents} cents points at line ${t.lineIndex}, which does not exist`));
    } else charged[t.lineIndex] += t.amountCents;
  }

  lines.forEach((line, i) => {
    const n = i + 1; // findings say "line 1" for the first line, as a clerk would count
    const code = taxCodes.find((c) => c.code === line.taxCode);
    if (!code) {
      findings.push(bad(i, 'UNKNOWN_TAX_CODE', `Line ${n}: tax code ${line.taxCode ?? '(none)'} is not a known code`));
      return;
    }
    if (code.province !== null && code.province !== deliveryProvince) {
      findings.push(bad(i, 'WRONG_PROVINCE_CODE', `Line ${n}: code ${code.code} is for ${code.province} but delivery is to ${deliveryProvince}`));
      return; // expected amount is unknowable with the wrong code, so do not stack more findings
    }
    const expected = expectedTaxCents(line.amountCents, code.rateBps);
    if (code.rateBps === 0) {
      if (charged[i] !== 0) findings.push(bad(i, 'TAX_ON_EXEMPT', `Line ${n}: code ${code.code} is exempt or zero-rated but ${charged[i]} cents of tax was charged`));
    } else if (charged[i] === 0 && expected !== 0) {
      findings.push(bad(i, 'MISSING_TAX', `Line ${n}: expected ${expected} cents of tax (${code.code}) but none was charged`));
    } else if (Math.abs(charged[i] - expected) > TOLERANCE_CENTS) {
      findings.push(bad(i, 'TAX_MISMATCH', `Line ${n}: expected ${expected} cents of tax (${code.code}) but ${charged[i]} was charged`));
    }
  });
  return findings;
}

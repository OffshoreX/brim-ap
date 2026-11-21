import type { TaxFinding } from './tax.types';

const TOLERANCE_CENTS = 1;
const SCALE = 100000; // rates are integers in 1/100000 so 9.975% is exactly 9975

// One row of the tax_codes table. rateE5: 0.13 -> 13000. appliesTo: 'goods' means never on services.
export type TaxCodeRate = { code: string; rateE5: number; appliesTo: 'all' | 'goods' };
// One invoice line as the dataset has it: its two tax codes (empty = none) and its type.
export type TaxLine = { amountCents: number; lineType: 'goods' | 'services'; gstHstCode: string | null; pstQstCode: string | null };
// Invoice-level tax actually charged (the dataset only stores totals, not tax per line).
export type ChargedTax = { gstHstCents: number; pstQstCents: number };

// Province -> the codes the law requires there. This is tax law, not dataset values.
const PROVINCE_CODES: Record<string, { gstHst: string; pstQst: string | null }> = {
  ON: { gstHst: 'HST13', pstQst: null },
  AB: { gstHst: 'GST5', pstQst: null },
  BC: { gstHst: 'GST5', pstQst: 'PST7_BC' },
  QC: { gstHst: 'GST5', pstQst: 'QST9975' },
};
const NO_TAX = ['EXEMPT', 'FOREIGN']; // valid in every province, carry no tax

// The codes a line must carry in a province (same table checkTax judges by); null = no rules for that province.
export function requiredTaxCodes(province: string, lineType: 'goods' | 'services', taxCodes: TaxCodeRate[]): { gstHst: string; pstQst: string | null } | null {
  const rule = PROVINCE_CODES[province];
  if (!rule) return null;
  const goodsOnly = rule.pstQst !== null && taxCodes.find((t) => t.code === rule.pstQst)?.appliesTo === 'goods' && lineType === 'services';
  return { gstHst: rule.gstHst, pstQst: goodsOnly ? null : rule.pstQst };
}

// Exact decimal string ("0.09975") to rateE5 with no float math.
export function rateToE5(rate: string): number {
  const [whole, frac = ''] = rate.split('.');
  return Number(whole) * SCALE + Number(frac.padEnd(5, '0').slice(0, 5));
}

// Integer math, half away from zero, so a credit note rounds like the invoice it reverses.
export function expectedTaxCents(amountCents: number, rateE5: number): number {
  const sign = amountCents < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(amountCents) * rateE5 + SCALE / 2) / SCALE);
}

export function checkTax(
  lines: TaxLine[],
  charged: ChargedTax,
  shipToProvince: string,
  taxCodes: TaxCodeRate[],
): TaxFinding[] {
  const out: TaxFinding[] = [];
  const add = (lineIndex: number | null, code: string, message: string) =>
    out.push({ code, message, severity: 'error', lineIndex });
  const nums = [charged.gstHstCents, charged.pstQstCents, ...lines.map((l) => l.amountCents)];
  if (!nums.every(Number.isSafeInteger)) return [{ code: 'NON_INTEGER_CENTS', message: 'All amounts must be integer cents', severity: 'error', lineIndex: null }];

  const rule = PROVINCE_CODES[shipToProvince];
  if (!rule) return [{ code: 'UNKNOWN_PROVINCE', message: `No tax rules for ship-to province ${shipToProvince}`, severity: 'error', lineIndex: null }];
  const rateOf = (c: string) => taxCodes.find((t) => t.code === c);

  let gstBase = 0; // pre-tax amount that should carry GST/HST
  let pstBase = 0; // pre-tax amount that should carry PST/QST
  let wrongCode = false;
  lines.forEach((line, i) => {
    const n = i + 1; // findings say "line 1" for the first line, as a clerk would count
    const gst = line.gstHstCode || null;
    const pst = line.pstQstCode || null;
    const exempt = gst !== null && NO_TAX.includes(gst);
    if (gst !== null && !exempt && !rateOf(gst)) { add(i, 'UNKNOWN_TAX_CODE', `Line ${n}: tax code ${gst} is not a known code`); wrongCode = true; return; }
    if (pst !== null && !rateOf(pst)) { add(i, 'UNKNOWN_TAX_CODE', `Line ${n}: tax code ${pst} is not a known code`); wrongCode = true; return; }
    if (exempt) {
      if (pst !== null) { add(i, 'TAX_ON_EXEMPT', `Line ${n}: ${gst} line also carries ${pst}`); wrongCode = true; }
      return; // exempt and foreign lines add nothing to either base
    }
    if (gst !== rule.gstHst) {
      add(i, 'WRONG_PROVINCE_CODE', `Line ${n}: code ${gst ?? '(none)'} but ${shipToProvince} requires ${rule.gstHst}`);
      wrongCode = true;
      return;
    }
    gstBase += line.amountCents;
    if (pst === null) {
      // BC/QC lines without their second tax are caught as MISSING_TAX at invoice level
      if (rule.pstQst && !(rateOf(rule.pstQst)?.appliesTo === 'goods' && line.lineType === 'services')) pstBase += line.amountCents;
    } else if (pst !== rule.pstQst) {
      add(i, 'WRONG_PROVINCE_CODE', `Line ${n}: code ${pst} is not valid for ${shipToProvince}`);
      wrongCode = true;
    } else if (rateOf(pst)?.appliesTo === 'goods' && line.lineType === 'services') {
      add(i, 'PST_ON_SERVICES', `Line ${n}: ${pst} applies to goods only but this is a services line`);
      wrongCode = true;
    } else pstBase += line.amountCents;
  });
  if (wrongCode) return out; // expected amounts are unknowable with wrong codes, so do not stack more findings

  const gstRate = rateOf(rule.gstHst)?.rateE5 ?? 0;
  const pstRate = rule.pstQst ? rateOf(rule.pstQst)?.rateE5 ?? 0 : 0;
  const expGst = expectedTaxCents(gstBase, gstRate);
  const expPst = expectedTaxCents(pstBase, pstRate);
  const compare = (name: string, got: number, want: number) => {
    if (want === 0 && got !== 0) add(null, 'TAX_ON_EXEMPT', `${name}: ${got} cents charged but nothing is taxable (exempt, foreign or not goods)`);
    else if (got === 0 && want !== 0) add(null, 'MISSING_TAX', `${name}: expected ${want} cents but none was charged`);
    else if (Math.abs(got - want) > TOLERANCE_CENTS) {
      // QST on top of GST is the classic mistake: name it when that explains the charge
      const onGross = expectedTaxCents(pstBase + expGst, pstRate);
      if (name === 'PST/QST' && Math.abs(got - onGross) <= TOLERANCE_CENTS) add(null, 'QST_ON_GST_INCLUSIVE', `${name}: ${got} cents looks computed on the GST-inclusive amount; expected ${want} on the pre-tax amount`);
      else add(null, 'TAX_MISMATCH', `${name}: expected ${want} cents but ${got} was charged`);
    }
  };
  compare('GST/HST', charged.gstHstCents, expGst);
  compare('PST/QST', charged.pstQstCents, expPst);
  return out;
}

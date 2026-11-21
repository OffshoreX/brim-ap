import { checkTax, TAX_PROVINCES, type ChargedTax, type TaxCodeRate, type TaxLine } from './tax';
import type { TaxFinding } from './tax.types';

// Where a supply was made, and how we know. 'invoice' is printed on the document: the only certain source.
// The others are guesses, listed in the order we trust them.
export type SupplySource = 'invoice' | 'po_requester' | 'requester' | 'vendor' | 'clerk';
export type Supply = { province: string; source: SupplySource };
export type SupplyInputs = {
  printed?: string | null; // ship-to province read from the invoice
  poRequester?: string | null; // work province of whoever raised the matched PO
  requester?: string | null; // work province of the invoice's requester (not the clerk who keyed it in)
  vendor?: string | null; // vendor's own province_or_state
  clerk?: string | null; // province of the AP clerk handling it: last resort
};
// chosen: what the tax is judged against first. candidates: the guessed provinces (never the clerk) the tax may also match.
export type Resolved = { chosen: Supply | null; candidates: Supply[] };

export const SUPPLY_LABEL: Record<SupplySource, string> = {
  invoice: 'invoice ship-to', po_requester: 'PO requester province', requester: 'requester province', vendor: 'vendor province', clerk: 'AP clerk province',
};

const clean = (p: string | null | undefined) => p?.trim().toUpperCase() || null;

// Order: printed ship-to, then PO requester, requester, vendor, and the clerk only when nothing else is known.
// A guessed province we have no tax rules for (a US vendor, MB) is skipped: it could only produce a meaningless "unknown province" error.
export function resolveSupply(i: SupplyInputs): Resolved {
  const printed = clean(i.printed);
  const guesses: Supply[] = ([['po_requester', i.poRequester], ['requester', i.requester], ['vendor', i.vendor]] as const)
    .flatMap(([source, p]) => (clean(p) && TAX_PROVINCES.includes(clean(p)!) ? [{ province: clean(p)!, source }] : []));
  const clerk = clean(i.clerk);
  const chosen: Supply | null = printed ? { province: printed, source: 'invoice' } : guesses[0] ?? (clerk ? { province: clerk, source: 'clerk' } : null);
  return { chosen, candidates: printed ? [] : guesses };
}

const hasError = (fs: TaxFinding[]) => fs.some((f) => f.severity === 'error');

// Judges the invoice's tax by the resolved place of supply and says which province it ended up using.
// Printed ship-to: a mismatch is an error. Guessed: the tax is accepted (info) if it fits another candidate, a warning if it fits
// some province we do not know the invoice went to, and still an error if it fits no province at all (a true tax error).
export function checkTaxAtSupply(lines: TaxLine[], charged: ChargedTax, supply: Resolved, taxCodes: TaxCodeRate[]): { findings: TaxFinding[]; supply: Supply | null } {
  const { chosen } = supply;
  const findings = checkTax(lines, charged, chosen?.province ?? '(unknown)', taxCodes);
  if (!chosen || chosen.source === 'invoice' || !hasError(findings)) return { findings, supply: chosen };

  const fits = (province: string) => !hasError(checkTax(lines, charged, province, taxCodes));
  const other = supply.candidates.find((c) => c.province !== chosen.province && fits(c.province));
  if (other)
    return {
      supply: other,
      findings: [{ code: 'TAX_MATCHES_OTHER_PROVINCE', severity: 'info', lineIndex: null, message: `Tax matches the ${SUPPLY_LABEL[other.source]} (${other.province}), delivery unconfirmed` }],
    };
  if (TAX_PROVINCES.some(fits))
    return {
      supply: chosen,
      findings: findings.map((f) => ({ ...f, code: 'TAX_PLACE_ASSUMED', severity: 'warning', message: `${f.message}; place of supply assumed from ${SUPPLY_LABEL[chosen.source]} (${chosen.province})` })),
    };
  return { findings, supply: chosen };
}

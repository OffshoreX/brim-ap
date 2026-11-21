// Picks the vendor master record an invoice's vendor belongs to. Pure function, no DB, no LLM.
// Order of trust: tax number, then the name as written, then the name with formatting noise removed.
// Zero hits or several hits is a result for a human, never a guess.

export type VendorRef = { id: number; name: string; taxNumber?: string | null };
export type VendorMatch =
  | { status: "matched"; id: number; by: "tax_number" | "exact_name" | "normalized_name" }
  | { status: "ambiguous"; ids: number[] }
  | { status: "none" };

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); // "Rivière" -> "riviere"

// Name as written: case, accents, spaces and punctuation ignored. "&" and "and" stay different words here.
export const exactKey = (s: string) => fold(s).replace(/[^a-z0-9]/g, "");

// Legal forms say what kind of company it is, not which one. Compared after punctuation is removed ("S.E.N.C.R.L." -> "sencrl").
const SUFFIXES = new Set(["inc", "incorporated", "ltd", "limited", "ltee", "limitee", "llc", "llp", "lp", "corp", "corporation", "co", "company", "sencrl", "cie"]);

// Looser key: "&" becomes "and", "and" and trailing legal forms are dropped. "Harlow & Stern LLP" and "Harlow and Stern Limited" agree.
export function looseKey(s: string): string {
  const words = fold(s)
    .replace(/&/g, " and ")
    .replace(/\./g, "") // dots join letters (S.E.N.C.R.L.), other punctuation separates words
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && w !== "and");
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join("");
}

// GST/HST numbers look like "995133220RT0001"; letters and digits only, any case.
const taxKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const only = (hits: VendorRef[], by: "tax_number" | "exact_name" | "normalized_name"): VendorMatch | null =>
  hits.length === 1 ? { status: "matched", id: hits[0].id, by } : null;

// ponytail: a tax number that is on the invoice but not in the master falls through to the name; flagging it is a later rule.
export function matchVendor(invoiceName: string, vendors: VendorRef[], invoiceTaxNumber?: string | null): VendorMatch {
  // Duplicate master records share a tax number, so several tax hits are narrowed by name below instead of guessed.
  const tax = taxKey(invoiceTaxNumber);
  const pool = tax ? vendors.filter((v) => taxKey(v.taxNumber) === tax) : [];
  const byTax = only(pool, "tax_number");
  if (byTax) return byTax;
  const candidates = pool.length > 1 ? pool : vendors;

  // Same record name beats a looser match: "Polar Freight Lines Ltd." is V001 even though "...Limited" is a lookalike record.
  const exact = candidates.filter((v) => exactKey(v.name) === exactKey(invoiceName));
  if (exact.length > 0) return only(exact, "exact_name") ?? { status: "ambiguous", ids: exact.map((v) => v.id) };

  const key = looseKey(invoiceName);
  const loose = key ? candidates.filter((v) => looseKey(v.name) === key) : []; // a name of only noise words matches nothing
  if (loose.length > 0) return only(loose, "normalized_name") ?? { status: "ambiguous", ids: loose.map((v) => v.id) };
  return pool.length > 1 ? { status: "ambiguous", ids: pool.map((v) => v.id) } : { status: "none" };
}

// Invoice list filters. The URL keeps what the user typed (dollars, dates); the server gets cents and its own parameter names.
export const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount_desc", label: "Amount, high to low" },
  { value: "amount_asc", label: "Amount, low to high" },
  { value: "due_asc", label: "Due date, soonest first" },
] as const;

export interface InvoiceFilters {
  q?: string | undefined;
  vendor?: number | undefined;
  min?: string | undefined; // dollars, as typed
  max?: string | undefined;
  from?: string | undefined; // YYYY-MM-DD
  to?: string | undefined;
  dueFrom?: string | undefined;
  dueTo?: string | undefined;
  sort?: string | undefined;
}
export type InvoiceQuery = { status?: string | undefined; limit: number; offset: number } & {
  q?: string; vendorId?: number; minCents?: number; maxCents?: number; from?: string; to?: string; dueFrom?: string; dueTo?: string; sort?: string;
};

// "1,234.5" -> 123450. Whole cents only, done on the digits so no float ever touches money. Not a valid amount -> undefined.
export function dollarsToCents(text: string | undefined): number | undefined {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec((text ?? "").trim().replace(/^\$/, "").replace(/,/g, ""));
  if (!m) return undefined;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

const SORT_VALUES: readonly string[] = SORTS.map((s) => s.value);
// The router turns "1000" in the URL into the number 1000, so numbers count as text too.
const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() || undefined : undefined);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

// Reads the URL search object; anything malformed is dropped rather than sent to the server.
export function parseFilters(s: Record<string, unknown>): InvoiceFilters {
  const vendor = Number(s["vendor"]);
  const sort = text(s["sort"]);
  return {
    q: text(s["q"]),
    vendor: Number.isInteger(vendor) && vendor > 0 ? vendor : undefined,
    min: text(s["min"]),
    max: text(s["max"]),
    from: date(s["from"]),
    to: date(s["to"]),
    dueFrom: date(s["dueFrom"]),
    dueTo: date(s["dueTo"]),
    sort: sort && SORT_VALUES.includes(sort) && sort !== "newest" ? sort : undefined, // newest is the server default
  };
}

export function toApi(f: InvoiceFilters): Omit<InvoiceQuery, "status" | "limit" | "offset"> {
  const out: Omit<InvoiceQuery, "status" | "limit" | "offset"> = {};
  if (f.q) out.q = f.q;
  if (f.vendor) out.vendorId = f.vendor;
  const min = dollarsToCents(f.min);
  const max = dollarsToCents(f.max);
  if (min !== undefined) out.minCents = min;
  if (max !== undefined) out.maxCents = max;
  for (const k of ["from", "to", "dueFrom", "dueTo", "sort"] as const) if (f[k]) out[k] = f[k]!;
  return out;
}

export const hasFilters = (f: InvoiceFilters) => Object.values(f).some((v) => v !== undefined);

// Plain-English list of what is filtering the list, for the empty state ("vendor Acme, amount from $100").
export function describeFilters(f: InvoiceFilters, vendorName?: string): string[] {
  const out: string[] = [];
  if (f.q) out.push(`search "${f.q}"`);
  if (f.vendor) out.push(`vendor ${vendorName ?? `#${f.vendor}`}`);
  if (f.min) out.push(`amount from $${f.min}`);
  if (f.max) out.push(`amount up to $${f.max}`);
  if (f.from) out.push(`invoice date from ${f.from}`);
  if (f.to) out.push(`invoice date to ${f.to}`);
  if (f.dueFrom) out.push(`due from ${f.dueFrom}`);
  if (f.dueTo) out.push(`due to ${f.dueTo}`);
  return out;
}

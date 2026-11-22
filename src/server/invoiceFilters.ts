// Search filters for GET /api/invoices (T85). Parsing is plain code; the SQL uses bound parameters only.
export const SORTS = {
  newest: "i.id DESC",
  oldest: "i.id ASC",
  amount_desc: "i.total_cents DESC, i.id DESC",
  amount_asc: "i.total_cents ASC, i.id DESC",
  due_asc: "(i.due_date IS NULL OR i.due_date = '') ASC, i.due_date ASC, i.id DESC", // no due date sorts last
} as const;
export type InvoiceSort = keyof typeof SORTS;

export type InvoiceFilters = {
  q?: string; vendorId?: number; minCents?: number; maxCents?: number;
  from?: string; to?: string; dueFrom?: string; dueTo?: string; sort?: InvoiceSort;
};

const isDate = (s: string) => {
  const d = new Date(s + "T00:00:00Z"); // invalid dates (month 13) give NaN; Feb 30 rolls over, so compare back
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const whole = (s: string) => (/^\d+$/.test(s) ? Number(s) : NaN);

// Returns the filters, or a plain-English error message for the first bad input.
export function parseInvoiceFilters(params: URLSearchParams): InvoiceFilters | string {
  const f: InvoiceFilters = {};
  const get = (k: string) => params.get(k)?.trim() || undefined; // empty counts as absent

  const q = get("q");
  if (q !== undefined) {
    if (q.length > 100) return "q must be 100 characters or fewer";
    f.q = q;
  }
  for (const k of ["vendorId", "minCents", "maxCents"] as const) {
    const v = get(k);
    if (v === undefined) continue;
    const n = whole(v);
    if (!Number.isSafeInteger(n) || (k === "vendorId" && n < 1)) return `${k} must be a whole number${k === "vendorId" ? " from 1" : " of cents, 0 or more"}`;
    f[k] = n;
  }
  for (const k of ["from", "to", "dueFrom", "dueTo"] as const) {
    const v = get(k);
    if (v === undefined) continue;
    if (!isDate(v)) return `${k} must be a real date written YYYY-MM-DD`;
    f[k] = v;
  }
  if (f.minCents !== undefined && f.maxCents !== undefined && f.minCents > f.maxCents) return "minCents cannot be more than maxCents";
  if (f.from && f.to && f.from > f.to) return "from cannot be after to";
  if (f.dueFrom && f.dueTo && f.dueFrom > f.dueTo) return "dueFrom cannot be after dueTo";

  const sort = get("sort");
  if (sort !== undefined) {
    if (!Object.hasOwn(SORTS, sort)) return `sort must be one of: ${Object.keys(SORTS).join(", ")}`;
    f.sort = sort as InvoiceSort;
  }
  return f;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

// Extra WHERE conditions (joined to vendors as v). Case-insensitive: SQLite LIKE ignores ASCII case.
export function filterConds(f: InvoiceFilters): { conds: string[]; args: unknown[] } {
  const conds: string[] = [];
  const args: unknown[] = [];
  const add = (c: string, a: unknown) => { conds.push(c); args.push(a); };
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    conds.push("(i.invoice_number LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  if (f.vendorId !== undefined) add("i.vendor_id = ?", f.vendorId);
  if (f.minCents !== undefined) add("i.total_cents >= ?", f.minCents);
  if (f.maxCents !== undefined) add("i.total_cents <= ?", f.maxCents);
  if (f.from) add("i.invoice_date >= ?", f.from);
  if (f.to) add("i.invoice_date <= ?", f.to);
  if (f.dueFrom) add("i.due_date >= ?", f.dueFrom);
  if (f.dueTo) add("i.due_date <= ?", f.dueTo);
  return { conds, args };
}

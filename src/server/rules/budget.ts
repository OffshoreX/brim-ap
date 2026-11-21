import type { Finding } from "./types";

export type BudgetInput = { annualBudgetCents: number | null; ytdSpendCents: number; invoiceCents: number; asOf: string };

const money = (c: number) => `${(c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CAD`;

// Whole days from Jan 1 to the date, counting Jan 1 as day 1, and the days in that year. UTC so DST never shifts it.
function yearProgress(asOf: string): { day: number; days: number } {
  const t = Date.parse(asOf);
  const year = new Date(t).getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  return { day: Math.floor((t - start) / 86_400_000) + 1, days: (Date.UTC(year + 1, 0, 1) - start) / 86_400_000 };
}

// Warning only, never blocks. No budget on file (null or 0) means nothing to compare, so no flag.
// Spend so far plus this invoice is compared with the annual budget scaled to the share of the year elapsed (integer maths).
export function checkDepartmentBudget(i: BudgetInput): Finding[] {
  if (i.annualBudgetCents === null || i.annualBudgetCents <= 0 || i.invoiceCents <= 0) return [];
  const { day, days } = yearProgress(i.asOf);
  const allowed = Math.floor((i.annualBudgetCents * day) / days);
  const used = i.ytdSpendCents + i.invoiceCents;
  if (allowed <= 0 || used <= allowed) return [];
  const pct = Math.floor((used * 100) / allowed);
  return [{ code: "department_over_budget", severity: "warning", message: `Department spend with this invoice is ${money(used)}, ${pct}% of the ${money(allowed)} budgeted for ${day} of ${days} days of the year` }];
}

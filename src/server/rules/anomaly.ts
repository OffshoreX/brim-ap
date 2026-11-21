import type { Finding } from "./types";

// The rule and its thresholds, in one place: flag a total above 3.0x the vendor's median, once there are 5 past invoices.
export const OUTLIER_MIN_HISTORY = 5;
export const OUTLIER_MULTIPLE_X10 = 30; // tenths, so integer maths: 30 = 3.0x

const money = (c: number) => `${(c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CAD`;

// Middle value; for an even count, the average of the two middle values rounded down.
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.floor((s[m - 1] + s[m]) / 2);
}

// pastCents are the vendor's earlier totals in CAD cents. Credit notes (negative) are not purchases, so they are left out.
export function checkAmountOutlier(totalCadCents: number, pastCents: number[]): Finding[] {
  const past = pastCents.filter((c) => c > 0);
  if (totalCadCents <= 0 || past.length < OUTLIER_MIN_HISTORY) return [];
  const med = median(past);
  if (med <= 0 || totalCadCents * 10 <= med * OUTLIER_MULTIPLE_X10) return [];
  const x10 = Math.floor((totalCadCents * 10) / med);
  return [{ code: "amount_outlier", severity: "warning", message: `${Math.floor(x10 / 10)}.${x10 % 10}x the vendor median of ${money(med)} (${past.length} past invoices)` }];
}

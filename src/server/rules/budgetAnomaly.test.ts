import { describe, expect, test } from "vitest";
import { checkAmountOutlier, median } from "./anomaly";
import { checkDepartmentBudget } from "./budget";

describe("department budget", () => {
  // 2026-07-02 is day 183 of 365: half the year, so 1,000,000 cents budget allows 501,369 cents.
  const base = { annualBudgetCents: 1_000_000, ytdSpendCents: 400_000, invoiceCents: 100_000, asOf: "2026-07-02" };
  test("within the scaled budget: no flag", () => expect(checkDepartmentBudget(base)).toEqual([]));
  test("over the scaled budget: warning, not an error", () => {
    const f = checkDepartmentBudget({ ...base, invoiceCents: 200_000 });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "department_over_budget", severity: "warning" });
    expect(f[0].message).toContain("119%");
  });
  test("exactly at the scaled budget is not over", () => expect(checkDepartmentBudget({ ...base, ytdSpendCents: 0, invoiceCents: 501_369 })).toEqual([]));
  test("zero or missing budget: no flag", () => {
    expect(checkDepartmentBudget({ ...base, annualBudgetCents: 0 })).toEqual([]);
    expect(checkDepartmentBudget({ ...base, annualBudgetCents: null })).toEqual([]);
  });
  test("a credit note (negative) never raises the flag", () => expect(checkDepartmentBudget({ ...base, ytdSpendCents: 900_000, invoiceCents: -5000 })).toEqual([]));
  test("the date is an argument: same spend is fine late in the year, over early in it", () => {
    expect(checkDepartmentBudget({ ...base, asOf: "2026-12-31" })).toEqual([]);
    expect(checkDepartmentBudget({ ...base, asOf: "2026-02-01" })).toHaveLength(1);
  });
});

describe("amount outlier", () => {
  const past = [100_000, 110_000, 90_000, 105_000, 95_000]; // median 100,000
  test("median of odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2);
  });
  test("too little history: no flag, however large", () => expect(checkAmountOutlier(10_000_000, past.slice(0, 4))).toEqual([]));
  test("ordinary amount: no flag; exactly 3.0x: no flag", () => {
    expect(checkAmountOutlier(120_000, past)).toEqual([]);
    expect(checkAmountOutlier(300_000, past)).toEqual([]);
  });
  test("4.2x the median: warning with the reason", () => {
    const f = checkAmountOutlier(420_000, past);
    expect(f).toEqual([{ code: "amount_outlier", severity: "warning", message: "4.2x the vendor median of 1,000.00 CAD (5 past invoices)" }]);
  });
  test("negative credit notes in the history are excluded", () => {
    // with the credit notes counted the median would drop to 90,000 and a 280,000 invoice would be flagged
    expect(checkAmountOutlier(280_000, [...past, -50_000, -60_000, -70_000])).toEqual([]);
    // five purchases are still needed once credit notes are removed
    expect(checkAmountOutlier(10_000_000, [...past.slice(0, 3), -1, -2, -3])).toEqual([]);
  });
});

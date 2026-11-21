import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { importDataset } from "./importDataset";
import { buildReport, CATEGORIES, historyHits } from "./messReport";

process.env.DB_PATH = ":memory:";
const meta = { asOf: "2026-11-02", historicalInvoices: 0, incomingFiles: 0, incomingNotExtracted: [], incomingWithoutShipTo: 0 };

beforeEach(() => {
  resetDbForTests();
  importDataset(getDb());
});

test("every historical invoice is checked and the mess the README promises shows up", () => {
  const { hits, invoices } = historyHits();
  expect(invoices).toBe(426);
  const rows = Object.fromEntries(buildReport(hits, [], meta).rows.map((r) => [r.key, r]));
  for (const key of ["duplicate_exact", "duplicate_near", "paid_twice", "wrong_tax", "contract_fee", "contract_nte", "po_overrun", "po_missing", "vendor_status", "split"])
    expect(rows[key].history, key).toBeGreaterThan(0);
  expect(rows.duplicate_exact.examples.every((id) => id.startsWith("AP-"))).toBe(true);
});

test("a hit is counted once per invoice and category, with at most 3 examples", () => {
  const same = ["TAX_MISMATCH", "MISSING_TAX"].map((code) => ({ code, id: "AP-1" }));
  const rows = buildReport([...same, { code: "DUPLICATE_EXACT", id: "AP-2" }], [{ code: "TAX_MISMATCH", id: "a.pdf" }, { code: "weird_code", id: "b.pdf" }], meta);
  const tax = rows.rows.find((r) => r.key === "wrong_tax")!;
  expect(tax).toMatchObject({ history: 1, incoming: 1, examples: ["AP-1", "a.pdf"], codes: { TAX_MISMATCH: 2, MISSING_TAX: 1 } });
  expect(rows.other).toEqual({ weird_code: 1 }); // a code outside the categories is kept, not dropped
  expect(rows.rows).toHaveLength(CATEGORIES.length);
});

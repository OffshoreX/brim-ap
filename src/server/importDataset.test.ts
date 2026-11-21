import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "./db";
import { decimalToInt, importDataset, counts } from "./importDataset";

const fresh = () => {
  const d = new Database(":memory:");
  applySchema(d);
  return d;
};

test("decimalToInt is exact string math", () => {
  expect(decimalToInt("5124.23")).toBe(512423);
  expect(decimalToInt("0.10")).toBe(10);
  expect(decimalToInt("1")).toBe(100);
  expect(decimalToInt("1.37", 4)).toBe(13700);
  expect(decimalToInt("")).toBeNull();
  expect(() => decimalToInt("1.005")).toThrow(); // never round silently
});

test("imports every CSV with the expected row counts", () => {
  const d = fresh();
  const c = importDataset(d);
  expect(c).toMatchObject({ users: 40, vendors: 56, invoices: 426, invoice_lines: 809, approvals: 474, payments: 415 });
  expect(d.pragma("foreign_key_check")).toEqual([]);
});

test("amounts land as integer cents and ids keep their ext_id", () => {
  const d = fresh();
  importDataset(d);
  // AP-00004: USD 5124.23 at 1.3709 = CAD 7024.81 (cents, FX x10000)
  expect(d.prepare("SELECT * FROM invoices WHERE ext_id='AP-00004'").get()).toMatchObject({
    id: 4, total_cents: 512423, currency: "USD", fx_rate_to_cad_bps: 13709, total_cad_cents: 702481, department: "IT",
  });
  expect(d.prepare("SELECT id, ext_id, role FROM users WHERE ext_id='U003'").get()).toEqual({ id: 3, ext_id: "U003", role: "finance_manager" });
  expect(d.prepare("SELECT rate_bps FROM tax_codes WHERE code='QST9975'").get()).toEqual({ rate_bps: 997.5 });
  // an unpaid (scheduled) payment keeps paid_at NULL instead of defaulting to now
  expect(d.prepare("SELECT count(*) n FROM payments WHERE status='scheduled' AND paid_at IS NULL").get()).toEqual({ n: 18 });
  // every stored money column is a whole number
  expect(d.prepare("SELECT count(*) n FROM invoices WHERE typeof(total_cents)!='integer'").get()).toEqual({ n: 0 });
});

test("a second run adds no rows and changes no counts", () => {
  const d = fresh();
  const first = importDataset(d);
  const second = importDataset(d);
  expect(second).toEqual(first);
  expect(counts(d)).toEqual(first);
});

test("replaces the fake seed users instead of duplicating them", () => {
  const d = fresh();
  d.prepare("INSERT INTO users (id, name, role) VALUES (1, 'Erin Employee', 'employee')").run();
  importDataset(d);
  expect(d.prepare("SELECT name, ext_id FROM users WHERE id=1").get()).toEqual({ name: "Priya Raman", ext_id: "U001" });
});

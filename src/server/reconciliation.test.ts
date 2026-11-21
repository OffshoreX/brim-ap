import { beforeEach, expect, test } from "vitest";
import type { User } from "@/contracts";
import { getDb, resetDbForTests } from "./db";
import { importDataset } from "./importDataset";
import { applyReconciliation, reconciliationCsv, reconciliationReport } from "./reconciliation";

process.env.DB_PATH = ":memory:";
const user = { id: 1, role: "finance_manager" } as User;

beforeEach(() => {
  resetDbForTests();
  importDataset(getDb());
});

test("the dataset reconciles: almost everything matches, and the planted differences show up", () => {
  const { summary } = reconciliationReport({}, null);
  expect(summary.matched).toBeGreaterThan(380);
  expect(summary.amount_diff).toBe(3); // three EFTs where the bank moved one cent more than we paid
  expect(summary.payment_unmatched).toBe(1); // one cheque never cleared
  expect(summary.bank_no_payment).toBe(0); // bank fees are not vendor payments, so they are not alarms
  expect(summary.card_no_payment).toBeGreaterThan(0);
  expect(reconciliationReport({}, null).rows.every((r) => r.category !== "card_no_payment" || r.lineSource === "card")).toBe(true);
});

test("applying saves a status on every released payment, audits each change, and a second run changes nothing", () => {
  const first = applyReconciliation(user);
  const db = getDb();
  const released = (db.prepare("SELECT count(*) n FROM payments WHERE status IN ('settled','outstanding')").get() as { n: number }).n;
  expect(first.changed).toBe(released);
  expect((db.prepare("SELECT count(*) n FROM payments WHERE reconciliation_status IS NOT NULL").get() as { n: number }).n).toBe(released);
  const audits = db.prepare("SELECT actor_id, before, after FROM audit_log WHERE action = 'payment.reconcile'").all() as { actor_id: number; before: string; after: string }[];
  expect(audits).toHaveLength(released);
  expect(audits[0]).toMatchObject({ actor_id: 1, before: '{"reconciliationStatus":null}' });
  expect(applyReconciliation(user).changed).toBe(0);
});

test("a scheduled payment has not paid anything, so it is left out", () => {
  applyReconciliation(user);
  expect((getDb().prepare("SELECT count(*) n FROM payments WHERE status = 'scheduled' AND reconciliation_status IS NOT NULL").get() as { n: number }).n).toBe(0);
});

test("a changed bank amount flips the status on the next run, with before and after in the audit row", () => {
  const db = getDb();
  applyReconciliation(user);
  const bad = db.prepare("SELECT ext_id FROM bank_statement WHERE debit_cents IS NOT NULL AND description LIKE 'EFT PMT%' LIMIT 1").get() as { ext_id: string };
  db.prepare("UPDATE bank_statement SET debit_cents = debit_cents + 5 WHERE ext_id = ?").run(bad.ext_id);
  expect(applyReconciliation(user).changed).toBe(1);
  const row = db.prepare("SELECT before, after FROM audit_log WHERE action = 'payment.reconcile' ORDER BY id DESC LIMIT 1").get() as { before: string; after: string };
  expect(JSON.parse(row.before).reconciliationStatus).toBe("matched");
  expect(JSON.parse(row.after)).toMatchObject({ reconciliationStatus: "amount_diff", lineId: bad.ext_id });
});

test("filters and paging narrow the rows but the summary stays whole", () => {
  const all = reconciliationReport({}, null);
  const diffs = reconciliationReport({ category: "amount_diff" }, { limit: 2, offset: 1 });
  expect(diffs.total).toBe(3);
  expect(diffs.rows).toHaveLength(2);
  expect(diffs.summary).toEqual(all.summary);
  expect(reconciliationReport({ method: "CHEQUE" }, null).rows.every((r) => r.method === "CHEQUE")).toBe(true);
});

test("the CSV has money as decimals and quotes cells that need it", () => {
  const csv = reconciliationCsv({ category: "amount_diff" });
  const [head, first] = csv.trim().split("\r\n");
  expect(head).toBe("category,paymentId,invoiceNumber,vendor,method,payment,lineSource,lineId,lineText,lineDate,line,diff,note");
  expect(first).toMatch(/^amount_diff,\d+,.*,EFT,\d+\.\d\d,bank,BK-\d+,.*,0\.01,/);
  expect(csv.trim().split("\r\n")).toHaveLength(4);
});

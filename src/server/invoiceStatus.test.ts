import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { canTransition, INVOICE_STATUSES, transition, type InvoiceStatus } from "./invoiceStatus";

process.env.DB_PATH = ":memory:";

const ALLOWED: [InvoiceStatus, InvoiceStatus][] = [
  ["received", "needs_review"],
  ["received", "pending_approval"],
  ["received", "rejected"],
  ["needs_review", "pending_approval"],
  ["needs_review", "rejected"],
  ["pending_approval", "approved"],
  ["pending_approval", "rejected"],
  ["approved", "scheduled"],
  ["approved", "paid"],
  ["scheduled", "paid"],
];

function makeInvoice(status: InvoiceStatus) {
  getDb()
    .prepare("INSERT INTO invoices (id, status, invoice_number, invoice_date, total_cents, currency) VALUES (1,?,'A-1','2026-11-20',1000,'CAD')")
    .run(status);
}

beforeEach(() => {
  resetDbForTests();
  getDb().prepare("INSERT INTO users (id, name, role) VALUES (1,'Cora','controller_admin')").run();
});

test.each(ALLOWED)("%s -> %s works", (from, to) => {
  makeInvoice(from);
  transition(1, to, 1);
  expect(getDb().prepare("SELECT status FROM invoices WHERE id=1").get()).toEqual({ status: to });
});

test("every pair not in the allowed list is forbidden", () => {
  for (const from of INVOICE_STATUSES)
    for (const to of INVOICE_STATUSES) {
      const allowed = ALLOWED.some(([f, t]) => f === from && t === to);
      expect(canTransition(from, to)).toBe(allowed);
    }
});

test.each([
  ["paid", "received"],
  ["rejected", "approved"],
  ["received", "paid"],
  ["approved", "pending_approval"],
  ["scheduled", "approved"],
  ["paid", "scheduled"],
] as [InvoiceStatus, InvoiceStatus][])("%s -> %s throws and changes nothing", (from, to) => {
  makeInvoice(from);
  expect(() => transition(1, to, 1)).toThrow();
  expect(getDb().prepare("SELECT status FROM invoices WHERE id=1").get()).toEqual({ status: from });
  expect(getDb().prepare("SELECT COUNT(*) c FROM audit_log").get()).toEqual({ c: 0 });
});

test("a transition writes one audit row with before and after", () => {
  makeInvoice("received");
  transition(1, "needs_review", 1);
  const rows = getDb().prepare("SELECT * FROM audit_log").all() as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ actor_id: 1, entity: "invoice", entity_id: "1" });
  expect(JSON.parse(rows[0].before)).toEqual({ status: "received" });
  expect(JSON.parse(rows[0].after)).toEqual({ status: "needs_review" });
});

import { beforeEach, expect, test } from "vitest";
import { budgetAndAnomalyFlags } from "./budgetAnomaly";
import { getDb, resetDbForTests } from "./db";

process.env.DB_PATH = ":memory:";

// Fixture: department budget 1,000,000 cents; as-of 2026-07-02 allows 501,369. Vendor has 5 past invoices of 10,000.
beforeEach(() => {
  resetDbForTests();
  getDb().exec(`
    INSERT INTO departments (id,name,annual_budget_cents) VALUES (1,'Ops',1000000);
    INSERT INTO users (id,name,role,department_id) VALUES (1,'Emp','employee',1);
    INSERT INTO vendors (id,name) VALUES (1,'Acme');
    INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,total_cents,currency,total_cad_cents,department_id) VALUES
      (1,'paid',1,'1','2026-01-10',10000,'CAD',10000,1),(2,'paid',1,'2','2026-02-10',10000,'CAD',10000,1),(3,'paid',1,'3','2026-03-10',10000,'CAD',10000,1),
      (4,'approved',1,'4','2026-04-10',10000,'CAD',10000,1),(5,'paid',1,'5','2026-05-10',10000,'CAD',10000,1),
      (6,'paid',1,'6','2025-12-31',900000,'CAD',900000,1),   -- last year: not year-to-date
      (7,'rejected',1,'7','2026-06-01',900000,'CAD',900000,1), -- rejected: not spend
      (8,'paid',1,'8','2026-06-02',-5000,'CAD',-5000,1);       -- credit note: not spend
  `);
});

const run = (totalCadCents: number) => budgetAndAnomalyFlags(getDb(), { invoiceId: 99, vendorId: 1, requesterId: 1, totalCadCents, asOf: "2026-07-02" }).map((f) => f.code);

test("ordinary invoice: no flags", () => expect(run(10_000)).toEqual([]));
test("big invoice: over budget (50,000 spent so far) and an outlier", () => expect(run(500_000)).toEqual(["department_over_budget", "amount_outlier"]));

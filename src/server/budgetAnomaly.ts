import type Database from "better-sqlite3";
import { checkAmountOutlier } from "./rules/anomaly";
import { checkDepartmentBudget } from "./rules/budget";
import type { Finding } from "./rules/types";

// Money that counts as spent: approved, scheduled or paid. Credit notes (negative) are not spend.
const SPENT = "status IN ('approved','scheduled','paid') AND total_cad_cents > 0";

// Gathers the inputs for the two warning rules from the DB; the rules themselves are plain functions.
// The department is the requester's, because uploads do not carry one.
export function budgetAndAnomalyFlags(
  db: Database.Database,
  i: { invoiceId: number; vendorId: number; requesterId: number | null; totalCadCents: number; asOf: string }
): Finding[] {
  const dept = i.requesterId === null ? undefined : (db.prepare("SELECT d.id, d.annual_budget_cents AS budget FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = ?").get(i.requesterId) as { id: number; budget: number | null } | undefined);
  const flags: Finding[] = [];
  if (dept) {
    const ytd = db
      .prepare(`SELECT COALESCE(SUM(total_cad_cents), 0) AS s FROM invoices WHERE department_id = ? AND ${SPENT} AND id != ? AND invoice_date >= ? AND invoice_date <= ?`)
      .get(dept.id, i.invoiceId, `${i.asOf.slice(0, 4)}-01-01`, i.asOf) as { s: number };
    flags.push(...checkDepartmentBudget({ annualBudgetCents: dept.budget, ytdSpendCents: ytd.s, invoiceCents: i.totalCadCents, asOf: i.asOf }));
  }
  const past = db.prepare("SELECT total_cad_cents AS c FROM invoices WHERE vendor_id = ? AND id != ? AND status != 'rejected' AND total_cad_cents IS NOT NULL").all(i.vendorId, i.invoiceId) as { c: number }[];
  flags.push(...checkAmountOutlier(i.totalCadCents, past.map((p) => p.c)));
  return flags;
}

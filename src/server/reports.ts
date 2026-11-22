import { csvCell } from "./csv";
import { getDb } from "./db";
import type { Page } from "./paging";
import { parseEarlyPayTerms } from "./rules/paymentTerms";

// Reporting reads only: every figure is a SQL aggregate over invoices/payments in CAD cents (never floats).
export const REPORT_ROLES = ["finance_manager", "controller_admin", "auditor"] as const;
// Not yet paid and not rejected. Uses idx_invoices_status.
const OPEN = "status IN ('received','needs_review','pending_approval','approved','scheduled')";
// Counts as spend: approved, scheduled or paid.
const SPENT = "status IN ('approved','scheduled','paid')";

export const AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AgingRow = { bucket: (typeof AGING_BUCKETS)[number]; invoices: number; totalCadCents: number };

// Open invoices that are past due on `asOf`, by days past due. Not-yet-due invoices are not "aging", so they are left out.
export function agingReport(asOf: string): AgingRow[] {
  const rows = getDb()
    .prepare(
      `SELECT CASE WHEN d <= 30 THEN '0-30' WHEN d <= 60 THEN '31-60' WHEN d <= 90 THEN '61-90' ELSE '90+' END AS bucket,
              COUNT(*) AS invoices, SUM(c) AS totalCadCents
       FROM (SELECT CAST(julianday(?) - julianday(due_date) AS INTEGER) AS d, COALESCE(total_cad_cents, 0) AS c
             FROM invoices WHERE ${OPEN} AND due_date IS NOT NULL AND due_date <= ?)
       GROUP BY bucket`
    )
    .all(asOf, asOf) as AgingRow[];
  return AGING_BUCKETS.map((b) => rows.find((r) => r.bucket === b) ?? { bucket: b, invoices: 0, totalCadCents: 0 });
}

export type SpendBy = "vendor" | "department" | "month";
export const SPEND_BY: readonly SpendBy[] = ["vendor", "department", "month"];
export type SpendRow = { key: string; invoices: number; totalCadCents: number };

// Group expressions are fixed strings (never user input), so they are safe to put in the SQL.
const GROUPS: Record<SpendBy, { join: string; key: string }> = {
  vendor: { join: "LEFT JOIN vendors g ON g.id = i.vendor_id", key: "COALESCE(g.name, '(unknown vendor)')" },
  department: { join: "LEFT JOIN departments g ON g.id = i.department_id", key: "COALESCE(g.name, '(no department)')" },
  month: { join: "", key: "substr(i.invoice_date, 1, 7)" },
};

// page null = everything (CSV export). Biggest spend first, key as tie-break so pages are stable.
export function spendReport(by: SpendBy, page: Page | null): { rows: SpendRow[]; total: number } {
  const db = getDb();
  const { join, key } = GROUPS[by];
  const from = `FROM invoices i ${join} WHERE i.${SPENT}`;
  const rows = db
    .prepare(`SELECT ${key} AS key, COUNT(*) AS invoices, COALESCE(SUM(i.total_cad_cents), 0) AS totalCadCents ${from} GROUP BY key ORDER BY totalCadCents DESC, key LIMIT ? OFFSET ?`)
    .all(page?.limit ?? -1, page?.offset ?? 0) as SpendRow[];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (SELECT ${key} AS key ${from} GROUP BY key)`).get() as { n: number }).n;
  return { rows, total };
}

export type DiscountRow = { vendor: string; terms: string; takenPayments: number; takenCadCents: number; missedPayments: number; missedCadCents: number };

// Per vendor with early-pay terms: discount taken on settled payments versus the discount a settled payment without one gave up.
// Missed is what the terms would have given on the invoice subtotal, rounded half up like the payment code does.
export function discountsReport(): DiscountRow[] {
  const db = getDb();
  const vendors = db.prepare("SELECT id, name, early_pay_discount AS terms FROM vendors WHERE early_pay_discount IS NOT NULL AND early_pay_discount != '' ORDER BY name").all() as { id: number; name: string; terms: string }[];
  const rate = "COALESCE(CASE WHEN p.currency = 'CAD' THEN 10000 END, p.fx_rate_to_cad_bps, 10000)";
  const stmt = db.prepare(
    `SELECT COALESCE(SUM(p.discount_taken_cents > 0), 0) AS takenPayments,
            COALESCE(SUM(CASE WHEN p.discount_taken_cents > 0 THEN p.discount_taken_cents * ${rate} / 10000 END), 0) AS takenCadCents,
            COALESCE(SUM(p.discount_taken_cents = 0 AND i.subtotal_cents > 0), 0) AS missedPayments,
            COALESCE(SUM(CASE WHEN p.discount_taken_cents = 0 AND i.subtotal_cents > 0 THEN ((i.subtotal_cents * CAST(? AS INTEGER) + 5000) / 10000) * ${rate} / 10000 END), 0) AS missedCadCents
     FROM invoices i JOIN payments p ON p.invoice_id = i.id WHERE i.vendor_id = ? AND p.status = 'settled'`
  );
  return vendors.flatMap((v) => {
    const t = parseEarlyPayTerms(v.terms);
    if (t.kind !== "discount") return []; // unreadable terms: no discount applies, so none is "missed"
    return [{ vendor: v.name, terms: v.terms, ...(stmt.get(t.percentBps, v.id) as Omit<DiscountRow, "vendor" | "terms">) }];
  });
}

// CSV cells go through the shared formula-injection guard in csv.ts.
const cell = (v: string | number) => csvCell(v);
export function toCsv<T extends Record<string, string | number>>(rows: T[], columns: (keyof T & string)[]): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

// JSON by default, a CSV download with ?format=csv. Anything else is a 400, not a silent JSON.
export function reportResponse<T extends Record<string, string | number>>(request: Request, name: string, rows: T[], columns: (keyof T & string)[], total?: number): Response {
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv")
    return new Response(toCsv(rows, columns), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  if (format !== null && format !== "json") return Response.json({ error: "format must be json or csv" }, { status: 400 });
  return Response.json(rows, total === undefined ? undefined : { headers: { "X-Total-Count": String(total) } });
}

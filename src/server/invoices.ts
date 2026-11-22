import type { User } from "@/contracts";
import { getDb } from "./db";
import { INVOICE_STATUSES } from "./invoiceStatus";
import { filterConds, SORTS, type InvoiceFilters } from "./invoiceFilters";
import { DEFAULT_PAGE, type Page } from "./paging";
import { parseFlags } from "./views";

export const isInvoiceStatus = (s: string) => (INVOICE_STATUSES as readonly string[]).includes(s);

// Response types live here, not in contracts.ts (lead-owned).
export type InvoiceListItem = {
  id: number;
  status: string;
  vendorId: number | null;
  invoiceNumber: string;
  invoiceDate: string;
  totalCents: number;
  currency: string;
  requesterId: number | null;
  sourceFile: string | null;
  vendorName: string | null;
  dueDate: string | null;
  flagCount: number;
};

type Row = {
  id: number; status: string; vendor_id: number | null; invoice_number: string; invoice_date: string;
  total_cents: number; currency: string; requester_id: number | null; source_file: string | null;
  vendor_name: string | null; due_date: string | null; flags: string | null;
};

// This is the only place that decides which invoices a role may see.
function visibleWhere(user: User, status?: string, f: InvoiceFilters = {}): { where: string; args: unknown[] } {
  const conds: string[] = [];
  const args: unknown[] = [];
  if (user.role === "employee") {
    conds.push("i.requester_id = ?");
    args.push(user.id);
  } else if (user.role === "approver") {
    conds.push("i.status = 'pending_approval'");
  } // ap_clerk, finance_manager, controller_admin, auditor see all
  if (status) { // the caller validated it; still a bound parameter
    conds.push("i.status = ?");
    args.push(status);
  }
  const extra = filterConds(f); // search filters only narrow what the role may already see
  conds.push(...extra.conds);
  args.push(...extra.args);
  return { where: conds.length ? "WHERE " + conds.join(" AND ") : "", args };
}

export function countInvoices(user: User, status?: string, f: InvoiceFilters = {}): number {
  const v = visibleWhere(user, status, f);
  return (getDb().prepare(`SELECT COUNT(*) n FROM invoices i LEFT JOIN vendors v ON v.id = i.vendor_id ${v.where}`).get(...v.args) as { n: number }).n;
}

// One query for every status chip. Same visibility as the list, so counts always match list totals.
export function invoiceCounts(user: User): { total: number; byStatus: Record<string, number> } {
  const v = visibleWhere(user);
  const rows = getDb().prepare(`SELECT i.status, COUNT(*) n FROM invoices i ${v.where} GROUP BY i.status`).all(...v.args) as { status: string; n: number }[];
  const byStatus = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, 0]));
  for (const r of rows) byStatus[r.status] = r.n;
  return { total: rows.reduce((t, r) => t + r.n, 0), byStatus };
}

// Newest first, so a fresh upload is on page one.
export function listInvoices(user: User, page: Page = DEFAULT_PAGE, status?: string, f: InvoiceFilters = {}): InvoiceListItem[] {
  const v = visibleWhere(user, status, f);
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.status, i.vendor_id, i.invoice_number, i.invoice_date, i.total_cents, i.currency, i.requester_id, i.source_file,
              v.name AS vendor_name, NULLIF(i.due_date, '') AS due_date, i.flags
       FROM invoices i LEFT JOIN vendors v ON v.id = i.vendor_id
       ${v.where} ORDER BY ${SORTS[f.sort ?? "newest"]} LIMIT ? OFFSET ?`
    )
    .all(...v.args, page.limit, page.offset) as Row[];
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    vendorId: r.vendor_id,
    invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date,
    totalCents: r.total_cents,
    currency: r.currency,
    requesterId: r.requester_id,
    sourceFile: r.source_file,
    vendorName: r.vendor_name,
    dueDate: r.due_date,
    flagCount: r.flags ? parseFlags(r.flags).length : 0, // same parsing as the detail view
  }));
}

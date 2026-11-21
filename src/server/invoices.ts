import type { User } from "@/contracts";
import { getDb } from "./db";
import { INVOICE_STATUSES } from "./invoiceStatus";
import { DEFAULT_PAGE, type Page } from "./paging";

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
};

type Row = {
  id: number; status: string; vendor_id: number | null; invoice_number: string; invoice_date: string;
  total_cents: number; currency: string; requester_id: number | null; source_file: string | null;
};

// This is the only place that decides which invoices a role may see.
function visibleWhere(user: User, status?: string): { where: string; args: unknown[] } {
  const conds: string[] = [];
  const args: unknown[] = [];
  if (user.role === "employee") {
    conds.push("requester_id = ?");
    args.push(user.id);
  } else if (user.role === "approver") {
    conds.push("status = 'pending_approval'");
  } // ap_clerk, finance_manager, controller_admin, auditor see all
  if (status) { // the caller validated it; still a bound parameter
    conds.push("status = ?");
    args.push(status);
  }
  return { where: conds.length ? "WHERE " + conds.join(" AND ") : "", args };
}

export function countInvoices(user: User, status?: string): number {
  const v = visibleWhere(user, status);
  return (getDb().prepare(`SELECT COUNT(*) n FROM invoices ${v.where}`).get(...v.args) as { n: number }).n;
}

// One query for every status chip. Same visibility as the list, so counts always match list totals.
export function invoiceCounts(user: User): { total: number; byStatus: Record<string, number> } {
  const v = visibleWhere(user);
  const rows = getDb().prepare(`SELECT status, COUNT(*) n FROM invoices ${v.where} GROUP BY status`).all(...v.args) as { status: string; n: number }[];
  const byStatus = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, 0]));
  for (const r of rows) byStatus[r.status] = r.n;
  return { total: rows.reduce((t, r) => t + r.n, 0), byStatus };
}

// Newest first, so a fresh upload is on page one.
export function listInvoices(user: User, page: Page = DEFAULT_PAGE, status?: string): InvoiceListItem[] {
  const v = visibleWhere(user, status);
  const rows = getDb()
    .prepare(
      `SELECT id, status, vendor_id, invoice_number, invoice_date, total_cents, currency, requester_id, source_file
       FROM invoices ${v.where} ORDER BY id DESC LIMIT ? OFFSET ?`
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
  }));
}

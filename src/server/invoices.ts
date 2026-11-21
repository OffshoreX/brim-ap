import type { User } from "@/contracts";
import { getDb } from "./db";
import { DEFAULT_PAGE, type Page } from "./paging";

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
function visibleWhere(user: User): { where: string; args: unknown[] } {
  let where = "";
  const args: unknown[] = [];
  if (user.role === "employee") {
    where = "WHERE requester_id = ?";
    args.push(user.id);
  } else if (user.role === "approver") {
    where = "WHERE status = 'pending_approval'";
  } // ap_clerk, finance_manager, controller_admin, auditor see all
  return { where, args };
}

export function countInvoices(user: User): number {
  const v = visibleWhere(user);
  return (getDb().prepare(`SELECT COUNT(*) n FROM invoices ${v.where}`).get(...v.args) as { n: number }).n;
}

export function listInvoices(user: User, page: Page = DEFAULT_PAGE): InvoiceListItem[] {
  const v = visibleWhere(user);
  const rows = getDb()
    .prepare(
      `SELECT id, status, vendor_id, invoice_number, invoice_date, total_cents, currency, requester_id, source_file
       FROM invoices ${v.where} ORDER BY id LIMIT ? OFFSET ?`
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

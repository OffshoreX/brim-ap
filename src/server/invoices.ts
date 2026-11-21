import type { User } from "@/contracts";
import { getDb } from "./db";

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
export function listInvoices(user: User): InvoiceListItem[] {
  let where = "";
  const args: unknown[] = [];
  if (user.role === "employee") {
    where = "WHERE requester_id = ?";
    args.push(user.id);
  } else if (user.role === "approver") {
    where = "WHERE status = 'pending_approval'";
  } // ap_clerk, finance_manager, controller_admin, auditor see all
  const rows = getDb()
    .prepare(
      `SELECT id, status, vendor_id, invoice_number, invoice_date, total_cents, currency, requester_id, source_file
       FROM invoices ${where} ORDER BY id`
    )
    .all(...args) as Row[];
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

import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { inspectUpload, storeUpload, UploadError } from "./files";

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
export type UploadResult = { invoiceId: number; status: string; duplicate: boolean };

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

// Validates every file first so a bad one in the batch stores nothing.
export function uploadInvoices(user: User, files: Buffer[]): UploadResult[] {
  if (files.length === 0) throw new UploadError("No files uploaded");
  const checked = files.map((b) => ({ bytes: b, ...inspectUpload(b) }));
  const db = getDb();
  return db.transaction(() =>
    checked.map(({ bytes, sha, ext }) => {
      const sourceFile = storeUpload(bytes, `${sha}.${ext}`);
      const existing = db.prepare("SELECT id, status FROM invoices WHERE source_file = ?").get(sourceFile) as
        | { id: number; status: string }
        | undefined;
      if (existing) {
        writeAudit({ actorId: user.id, action: "invoice.upload_duplicate", entity: "invoice", entityId: existing.id, after: { sourceFile } });
        return { invoiceId: existing.id, status: existing.status, duplicate: true };
      }
      // Extraction fills these later; the columns are NOT NULL so empty/zero stand in until then.
      const id = Number(
        db
          .prepare(
            "INSERT INTO invoices (status, invoice_number, invoice_date, total_cents, currency, requester_id, source_file) VALUES ('received','','',0,'CAD',?,?)"
          )
          .run(user.id, sourceFile).lastInsertRowid
      );
      writeAudit({ actorId: user.id, action: "invoice.upload", entity: "invoice", entityId: id, before: null, after: { status: "received", sourceFile } });
      return { invoiceId: id, status: "received", duplicate: false };
    })
  )();
}

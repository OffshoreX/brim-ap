import { INVOICE_STATUSES, type InvoiceStatus } from "../contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";

// The whole status flow in one table; anything not listed is forbidden.
const ALLOWED: Record<InvoiceStatus, InvoiceStatus[]> = {
  received: ["needs_review", "pending_approval", "rejected"],
  needs_review: ["pending_approval", "rejected"],
  pending_approval: ["approved", "rejected"],
  approved: ["paid"],
  rejected: [],
  paid: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function transition(invoiceId: number, to: InvoiceStatus, actorId: number | null) {
  if (!INVOICE_STATUSES.includes(to)) throw new Error(`Unknown status: ${to}`);
  const db = getDb();
  // One transaction so the status change and its audit row succeed or fail together.
  db.transaction(() => {
    const row = db.prepare("SELECT status FROM invoices WHERE id = ?").get(invoiceId) as
      | { status: InvoiceStatus }
      | undefined;
    if (!row) throw new Error(`Invoice ${invoiceId} not found`);
    if (!canTransition(row.status, to)) throw new Error(`Cannot go from ${row.status} to ${to}`);
    db.prepare("UPDATE invoices SET status = ? WHERE id = ?").run(to, invoiceId);
    writeAudit({
      actorId,
      action: "invoice.status",
      entity: "invoice",
      entityId: invoiceId,
      before: { status: row.status },
      after: { status: to },
    });
  })();
}

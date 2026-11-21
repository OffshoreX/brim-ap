import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { canRelease } from "./rules/release";
import { transition } from "./invoiceStatus";

// Response types live here, not in contracts.ts (lead-owned).
export type ReleaseResponse = { paymentId: number; invoiceId: number; status: "paid" };

// Carries the HTTP status so routes stay thin; 401/403 from authz use HttpError instead.
export class PaymentError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

// Role is already checked by requireRole in the route; canRelease adds the per-user limit.
export function releasePayment(user: User, invoiceId: number): ReleaseResponse {
  const db = getDb();
  // One transaction: payment row, status change and audit rows all succeed or all roll back.
  return db.transaction(() => {
    const inv = db
      .prepare("SELECT status, total_cents, currency FROM invoices WHERE id = ?")
      .get(invoiceId) as { status: string; total_cents: number; currency: string } | undefined;
    if (!inv) throw new PaymentError(404, "Invoice not found");
    // A paid invoice is not approved, so a second release lands here too.
    if (inv.status !== "approved") throw new PaymentError(409, `Invoice is ${inv.status}, not approved`);
    const check = canRelease(
      { role: user.role, releaseLimitCents: user.approval_limit_cents },
      { amountCents: inv.total_cents }
    );
    if (!check.allowed) throw new PaymentError(403, check.reason);
    const { lastInsertRowid } = db
      .prepare("INSERT INTO payments (invoice_id, amount_cents, currency, released_by) VALUES (?,?,?,?)")
      .run(invoiceId, inv.total_cents, inv.currency, user.id);
    const paymentId = Number(lastInsertRowid);
    transition(invoiceId, "paid", user.id);
    writeAudit({
      actorId: user.id,
      action: "payment.release",
      entity: "payment",
      entityId: paymentId,
      after: { invoiceId, amountCents: inv.total_cents, currency: inv.currency },
    });
    return { paymentId, invoiceId, status: "paid" as const };
  })();
}

// 12345 -> "123.45", integer math only.
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function eftFileCsv(): string {
  const rows = getDb()
    .prepare(
      `SELECT p.id, i.invoice_number, v.name AS vendor, v.bank_institution, v.bank_transit, v.bank_account, p.amount_cents, p.currency
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN vendors v ON v.id = i.vendor_id
       ORDER BY p.id`
    )
    .all() as {
    id: number;
    invoice_number: string;
    vendor: string | null;
    bank_institution: string | null;
    bank_transit: string | null;
    bank_account: string | null;
    amount_cents: number;
    currency: string;
  }[];
  const lines = rows.map((r) =>
    [r.invoice_number, r.vendor ?? "", [r.bank_institution, r.bank_transit, r.bank_account].filter(Boolean).join("-"), formatCents(r.amount_cents), r.currency, `PAY-${r.id}`]
      .map(csvCell)
      .join(",")
  );
  return ["invoice_number,vendor,bank_details,amount,currency,reference", ...lines].join("\n") + "\n";
}

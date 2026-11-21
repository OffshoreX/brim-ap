import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { transition } from "./invoiceStatus";

// Response types live here, not in contracts.ts (lead-owned).
export type ExceptionFlag = { code: string; message: string };
export type ExceptionItem = {
  id: number;
  invoiceNumber: string;
  vendorId: number | null;
  totalCents: number;
  currency: string;
  flags: ExceptionFlag[];
};
export type ResolveAction = "send_to_approval" | "reject";
export type ResolveResponse = { invoiceId: number; status: "pending_approval" | "rejected" };

// Carries the HTTP status so routes stay thin.
export class ExceptionError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

// flags is JSON text; accept {code,message} objects or bare strings so new checks need no change here.
function parseFlags(text: string): ExceptionFlag[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [{ code: "unreadable_flags", message: "Flags could not be parsed" }];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((f) =>
    typeof f === "string"
      ? { code: f, message: f }
      : { code: String(f?.code ?? "unknown"), message: String(f?.message ?? f?.code ?? "") }
  );
}

export function listExceptions(): ExceptionItem[] {
  const rows = getDb()
    .prepare(
      "SELECT id, invoice_number, vendor_id, total_cents, currency, flags FROM invoices WHERE status = 'needs_review' ORDER BY id"
    )
    .all() as { id: number; invoice_number: string; vendor_id: number | null; total_cents: number; currency: string; flags: string }[];
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    vendorId: r.vendor_id,
    totalCents: r.total_cents,
    currency: r.currency,
    flags: parseFlags(r.flags),
  }));
}

export function resolveException(user: User, invoiceId: number, action: ResolveAction, note: string): ResolveResponse {
  const db = getDb();
  // One transaction: status change, its audit row and the note's audit row succeed or fail together.
  return db.transaction(() => {
    const row = db.prepare("SELECT status FROM invoices WHERE id = ?").get(invoiceId) as { status: string } | undefined;
    if (!row) throw new ExceptionError(404, "Invoice not found");
    if (row.status !== "needs_review") throw new ExceptionError(409, `Invoice is ${row.status}, not needs_review`);
    const status = action === "reject" ? ("rejected" as const) : ("pending_approval" as const);
    transition(invoiceId, status, user.id);
    writeAudit({
      actorId: user.id,
      action: "exception.resolve",
      entity: "invoice",
      entityId: invoiceId,
      before: { status: "needs_review" },
      after: { status, action, note },
    });
    return { invoiceId, status };
  })();
}

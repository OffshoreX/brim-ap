import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { DEFAULT_PAGE, type Page } from "./paging";
import { createChain } from "./approvals";
import { transition } from "./invoiceStatus";
import { bankDiffers, readInvoiceBank } from "./rules/bank";

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

export const countExceptions = () =>
  (getDb().prepare("SELECT COUNT(*) n FROM invoices WHERE status = 'needs_review'").get() as { n: number }).n;

export function listExceptions(page: Page = DEFAULT_PAGE): ExceptionItem[] {
  const rows = getDb()
    .prepare(
      "SELECT id, invoice_number, vendor_id, total_cents, currency, flags FROM invoices WHERE status = 'needs_review' ORDER BY id LIMIT ? OFFSET ?"
    )
    .all(page.limit, page.offset) as { id: number; invoice_number: string; vendor_id: number | null; total_cents: number; currency: string; flags: string }[];
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    vendorId: r.vendor_id,
    totalCents: r.total_cents,
    currency: r.currency,
    flags: parseFlags(r.flags),
  }));
}

// The account on the invoice is checked again against the vendor as it is now, so a bank change verified since the flag cleared it.
// Anything unreadable stays blocked: this never lets a doubtful invoice through.
function bankStillDiffers(invoiceId: number, extractionJson: string | null): boolean {
  const v = getDb().prepare("SELECT v.bank_institution, v.bank_transit, v.bank_account FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = ?").get(invoiceId) as
    | { bank_institution: string | null; bank_transit: string | null; bank_account: string | null }
    | undefined;
  try {
    const read = readInvoiceBank(JSON.parse(extractionJson ?? ""));
    return !v || read.kind !== "bank" || bankDiffers(read.bank, { institution: v.bank_institution ?? "", transit: v.bank_transit ?? "", account: v.bank_account ?? "" });
  } catch {
    return true;
  }
}

export function resolveException(user: User, invoiceId: number, action: ResolveAction, note: string): ResolveResponse {
  const db = getDb();
  // One transaction: status change, its audit row and the note's audit row succeed or fail together.
  return db.transaction(() => {
    const row = db.prepare("SELECT status, flags, extraction_json FROM invoices WHERE id = ?").get(invoiceId) as { status: string; flags: string; extraction_json: string | null } | undefined;
    if (!row) throw new ExceptionError(404, "Invoice not found");
    if (row.status !== "needs_review") throw new ExceptionError(409, `Invoice is ${row.status}, not needs_review`);
    if (action === "send_to_approval" && parseFlags(row.flags).some((f) => f.code === "bank_details_differ") && bankStillDiffers(invoiceId, row.extraction_json))
      throw new ExceptionError(409, "The invoice's bank account differs from the vendor's. A finance user must verify a bank change first.");
    const status = action === "reject" ? ("rejected" as const) : ("pending_approval" as const);
    // A held invoice was never routed (errors stop routing), so build its chain now; without one nobody could approve it.
    // If nobody can fill a step, the whole resolve rolls back and the invoice stays held.
    if (action === "send_to_approval" && !db.prepare("SELECT 1 FROM approval_steps WHERE invoice_id = ?").get(invoiceId)) {
      try {
        createChain(invoiceId, user.id);
      } catch (e) {
        throw new ExceptionError(409, `Cannot route this invoice for approval: ${e instanceof Error ? e.message : "unknown reason"}`);
      }
    }
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
  }).immediate();
}

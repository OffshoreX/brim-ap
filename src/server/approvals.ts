import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { loadApprovalRules } from "./approvalRules";
import { transition } from "./invoiceStatus";
import { routeApproval } from "./rules/approval";

// Response types live here, not in contracts.ts (lead-owned).
export type Decision = "approved" | "rejected";
export type DecisionResponse = { invoiceId: number; status: Decision; delegated: boolean; delegatedFromId: number | null };

// Carries the HTTP status so routes stay thin.
export class ApprovalError extends Error {
  constructor(public status: 403 | 404 | 409, message: string) {
    super(message);
  }
}

type UserRow = { id: number; role: string; manager_id: number | null; approval_limit_cents: number; status: string; delegate_user_id: number | null };
type InvoiceRow = { status: string; total_cents: number; department: string | null; requester_id: number | null };

const n = (id: number | null) => (id === null ? undefined : String(id));

export function decideInvoice(user: User, invoiceId: number, decision: Decision, comment: string): DecisionResponse {
  const db = getDb();
  // One transaction: the check, approvals row, status change and audit rows all succeed or all fail.
  return db.transaction(() => {
    const inv = db.prepare("SELECT status, total_cents, department, requester_id FROM invoices WHERE id = ?").get(invoiceId) as InvoiceRow | undefined;
    if (!inv) throw new ApprovalError(404, "Invoice not found");
    if (inv.status !== "pending_approval") throw new ApprovalError(409, `Invoice is ${inv.status}, not pending_approval`);
    // Checked first so a requester is refused even if routing would somehow name them.
    if (inv.requester_id === user.id) throw new ApprovalError(403, "You cannot decide an invoice you requested");

    // The server recomputes who may decide; nothing the client sends is trusted.
    const users = (db.prepare("SELECT id, role, manager_id, approval_limit_cents, status, delegate_user_id FROM users").all() as UserRow[]).map((u) => ({
      id: String(u.id),
      role: u.role,
      managerId: n(u.manager_id),
      limitCents: u.approval_limit_cents,
      onLeave: u.status === "on_leave",
      delegateId: n(u.delegate_user_id),
    }));
    const requester = users.find((u) => u.id === String(inv.requester_id)) ?? { id: "", role: "", limitCents: 0 };
    const route = routeApproval({ totalCents: inv.total_cents, department: inv.department ?? "" }, requester, users, loadApprovalRules());
    if (route.status !== "routed" || route.approverId !== String(user.id)) throw new ApprovalError(403, "You are not the approver for this invoice");

    const delegated = route.delegated;
    const delegatedFromId = delegated ? Number(route.delegatedFromId) : null;
    const info = db
      .prepare("INSERT INTO approvals (invoice_id, approver_id, decision, comment, delegated, delegated_from_id) VALUES (?,?,?,?,?,?)")
      .run(invoiceId, user.id, decision, comment, delegated ? 1 : 0, delegatedFromId);
    writeAudit({
      actorId: user.id,
      action: "approval.decide",
      entity: "invoice",
      entityId: invoiceId,
      before: { status: "pending_approval" },
      after: { status: decision, approvalId: Number(info.lastInsertRowid), comment, delegated, delegatedFromId },
    });
    transition(invoiceId, decision, user.id);
    return { invoiceId, status: decision, delegated, delegatedFromId };
  })();
}

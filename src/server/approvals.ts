import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { loadThresholds } from "./approvalRules";
import { transition } from "./invoiceStatus";
import { routeApprovalChain } from "./rules/chain";
import type { ChainStep } from "./rules/chain.types";
import { convertCents } from "./rules/fx";

// Response types live here, not in contracts.ts (lead-owned).
export type Decision = "approved" | "rejected";
// status is the invoice's status after this decision; it stays pending_approval until the last step approves.
export type DecisionResponse = {
  invoiceId: number;
  status: string;
  decision: Decision;
  stepNo: number;
  nextApproverId: number | null;
  delegated: boolean;
  delegatedFromId: number | null;
};

// Carries the HTTP status so routes stay thin.
export class ApprovalError extends Error {
  constructor(public status: 403 | 404 | 409, message: string) {
    super(message);
  }
}

const opt = (id: number | null) => (id === null ? undefined : String(id));

// Builds the chain with the pure rule and stores it as pending steps. Throws if nobody can fill a step;
// the caller turns that into needs_review. Call inside the processing transaction.
export function createChain(invoiceId: number, actorId: number | null): ChainStep[] {
  const db = getDb();
  return db.transaction(() => {
    const inv = db
      .prepare("SELECT invoice_date, total_cents, total_cad_cents, currency, fx_rate_to_cad_bps, requester_id, vendor_id FROM invoices WHERE id = ?")
      .get(invoiceId) as {
      invoice_date: string; total_cents: number; total_cad_cents: number | null; currency: string;
      fx_rate_to_cad_bps: number | null; requester_id: number | null; vendor_id: number | null;
    };
    // The thresholds are in CAD. A foreign amount is converted with the invoice's own rate or the dated table, never guessed.
    const fx = inv.fx_rate_to_cad_bps ?? (db.prepare("SELECT usd_to_cad_bps FROM fx_rates WHERE date = ?").get(inv.invoice_date) as { usd_to_cad_bps: number } | undefined)?.usd_to_cad_bps;
    const totalCadCents = inv.total_cad_cents ?? convertCents(inv.total_cents, inv.currency, "CAD", fx === undefined ? undefined : { from: inv.currency, to: "CAD", rateBps: fx });

    const users = (db.prepare("SELECT id, role, department_id, manager_id, status, delegate_user_id FROM users").all() as {
      id: number; role: string; department_id: number | null; manager_id: number | null; status: "active" | "on_leave" | "terminated"; delegate_user_id: number | null;
    }[]).map((u) => ({ id: String(u.id), role: u.role, departmentId: opt(u.department_id), managerId: opt(u.manager_id), status: u.status, delegateId: opt(u.delegate_user_id) }));
    const requester = users.find((u) => u.id === String(inv.requester_id));
    if (!requester) throw new Error("approval chain: invoice has no known requester");
    const departments = (db.prepare("SELECT id, manager_user_id FROM departments WHERE manager_user_id IS NOT NULL").all() as { id: number; manager_user_id: number }[]).map(
      (d) => ({ id: String(d.id), managerUserId: String(d.manager_user_id) })
    );
    const v = db.prepare("SELECT status, category, onboarded_at FROM vendors WHERE id = ?").get(inv.vendor_id) as
      | { status: string | null; category: string | null; onboarded_at: string | null }
      | undefined;
    if (!v) throw new Error("approval chain: invoice has no known vendor");

    const steps = routeApprovalChain(
      { totalCadCents, date: inv.invoice_date },
      requester,
      { status: v.status ?? "", category: v.category ?? "", onboardedAt: v.onboarded_at ?? undefined },
      users,
      departments,
      loadThresholds(),
    );
    const add = db.prepare("INSERT INTO approval_steps (invoice_id, step_no, role, user_id, delegated_from_id, reason) VALUES (?,?,?,?,?,?)");
    for (const s of steps) add.run(invoiceId, s.stepNo, s.role, Number(s.userId), s.delegatedFrom ? Number(s.delegatedFrom) : null, s.reason);
    writeAudit({ actorId, action: "invoice.routed", entity: "invoice", entityId: invoiceId, after: { totalCadCents, steps } });
    return steps;
  })();
}

type StepRow = { step_no: number; role: string; user_id: number; delegated_from_id: number | null; status: string };

// The check, the approvals row, the step, the status change and the audit rows are one transaction.
export function decideInvoice(user: User, invoiceId: number, decision: Decision, comment: string): DecisionResponse {
  const db = getDb();
  return db.transaction(() => {
    const inv = db.prepare("SELECT status, requester_id FROM invoices WHERE id = ?").get(invoiceId) as { status: string; requester_id: number | null } | undefined;
    if (!inv) throw new ApprovalError(404, "Invoice not found");
    if (inv.status !== "pending_approval") throw new ApprovalError(409, `Invoice is ${inv.status}, not pending_approval`);
    // An approval needs every line coded; a rejection does not.
    if (decision === "approved" && db.prepare("SELECT 1 FROM invoice_lines WHERE invoice_id = ? AND coding_needed = 1").get(invoiceId))
      throw new ApprovalError(409, "Some lines still need coding; a clerk or manager must set them first");
    // Checked first so a requester is refused even if the stored chain somehow named them.
    if (inv.requester_id === user.id) throw new ApprovalError(403, "You cannot decide an invoice you requested");

    // The stored chain decides who is next; nothing the client sends is trusted.
    const steps = db.prepare("SELECT step_no, role, user_id, delegated_from_id, status FROM approval_steps WHERE invoice_id = ? ORDER BY step_no").all(invoiceId) as StepRow[];
    const pending = steps.filter((s) => s.status === "pending");
    if (!pending.length) throw new ApprovalError(409, "Invoice has no pending approval step");
    const step = pending[0];
    if (step.user_id !== user.id) throw new ApprovalError(403, "You are not the next approver for this invoice");

    const delegated = step.delegated_from_id !== null;
    const info = db
      .prepare("INSERT INTO approvals (invoice_id, step_no, approver_id, approver_role, decision, comment, delegated, delegated_from_id) VALUES (?,?,?,?,?,?,?,?)")
      .run(invoiceId, step.step_no, user.id, step.role, decision, comment, delegated ? 1 : 0, step.delegated_from_id);
    db.prepare("UPDATE approval_steps SET status = ? WHERE invoice_id = ? AND step_no = ?").run(decision, invoiceId, step.step_no);

    // A rejection ends the chain; later steps are never asked.
    const rest = pending.slice(1);
    if (decision === "rejected") db.prepare("UPDATE approval_steps SET status = 'skipped' WHERE invoice_id = ? AND status = 'pending'").run(invoiceId);
    const done = decision === "rejected" || rest.length === 0;
    writeAudit({
      actorId: user.id,
      action: "approval.decide",
      entity: "invoice",
      entityId: invoiceId,
      before: { status: "pending_approval", stepNo: step.step_no, stepStatus: "pending" },
      after: { stepNo: step.step_no, role: step.role, stepStatus: decision, approvalId: Number(info.lastInsertRowid), comment, delegated, delegatedFromId: step.delegated_from_id, skippedSteps: decision === "rejected" ? rest.length : 0 },
    });
    if (done) transition(invoiceId, decision, user.id);
    return {
      invoiceId,
      status: done ? decision : "pending_approval",
      decision,
      stepNo: step.step_no,
      nextApproverId: done ? null : rest[0].user_id,
      delegated,
      delegatedFromId: step.delegated_from_id,
    };
  })();
}

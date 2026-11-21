import { getDb } from "./db";
import { loadThresholds } from "./approvalRules";
import { RELEASE_TIERS } from "./payments";
import { routeApprovalChain } from "./rules/chain";
import type { ChainUser } from "./rules/chain.types";
import { compareApprovals, checkRelease, describeCause, statusAt, type Divergence, type Recorded, type ReplayUser, type Verdict } from "./rules/replay";
import { DEFAULT_PAGE, type Page } from "./paging";

// Replays the imported history against today's routing and release rules. Read-only: nothing is written.
export type Finding = Divergence & { invoiceId: number; invoiceExtId: string; paymentId: number | null };
export type CauseRow = { code: string; label: string; verdict: Verdict; why: string; count: number; examples: string[] };
export type ReplayReport = { asOf: string; invoices: number; approvals: number; payments: number; causes: CauseRow[] };

type UserRow = { id: number; role: string; department_id: number | null; manager_id: number | null; approval_limit_cents: number; status: ReplayUser["status"]; status_since: string | null; delegate_user_id: number | null };

// The dataset's as-of date; it only matters for state that has no date of its own.
export const AS_OF = "2026-11-02";

export function replayFindings(): { findings: Finding[]; invoices: number; approvals: number; payments: number } {
  const db = getDb();
  const rows = db.prepare("SELECT id, role, department_id, manager_id, approval_limit_cents, status, status_since, delegate_user_id FROM users").all() as UserRow[];
  const departments = (db.prepare("SELECT id, manager_user_id FROM departments WHERE manager_user_id IS NOT NULL").all() as { id: number; manager_user_id: number }[]).map(
    (d) => ({ id: String(d.id), managerUserId: String(d.manager_user_id) })
  );
  // Users as they were on a date, so a leave that started in October does not rewrite January.
  const usersOn = (date: string): ChainUser[] =>
    rows.map((u) => ({ id: String(u.id), role: u.role, departmentId: u.department_id === null ? undefined : String(u.department_id), managerId: u.manager_id === null ? undefined : String(u.manager_id),
      status: statusAt({ status: u.status, statusSince: u.status_since }, date), delegateId: u.delegate_user_id === null ? undefined : String(u.delegate_user_id) }));
  const limits = new Map<string, ReplayUser & { statusSince: string | null }>(
    rows.map((u) => [String(u.id), { id: String(u.id), role: u.role, limitCents: u.approval_limit_cents, status: u.status, statusSince: u.status_since }])
  );

  // Missing thresholds must not crash the screen: every invoice then shows "routing failed" with the reason.
  let thresholds: ReturnType<typeof loadThresholds> | undefined;
  let thresholdError: unknown;
  try { thresholds = loadThresholds(); } catch (e) { thresholdError = e; }
  const invoices = db.prepare("SELECT id, ext_id, invoice_date, total_cad_cents, requester_id, vendor_id FROM invoices ORDER BY id").all() as
    { id: number; ext_id: string | null; invoice_date: string; total_cad_cents: number | null; requester_id: number | null; vendor_id: number | null }[];
  const approvals = db.prepare("SELECT invoice_id, step_no, approver_id, approver_role, decision, decided_at FROM approvals ORDER BY invoice_id, step_no").all() as
    { invoice_id: number; step_no: number; approver_id: number; approver_role: string | null; decision: "approved" | "rejected"; decided_at: string }[];
  const byInvoice = new Map<number, Recorded[]>();
  for (const a of approvals) {
    const list = byInvoice.get(a.invoice_id) ?? [];
    list.push({ stepNo: a.step_no, userId: String(a.approver_id), role: a.approver_role ?? "", decision: a.decision, at: a.decided_at });
    byInvoice.set(a.invoice_id, list);
  }
  const vendors = new Map((db.prepare("SELECT id, status, category, onboarded_at FROM vendors").all() as { id: number; status: string | null; category: string | null; onboarded_at: string | null }[]).map((v) => [v.id, v]));

  const findings: Finding[] = [];
  const add = (inv: { id: number; ext_id: string | null }, d: Divergence[], paymentId: number | null = null) =>
    d.forEach((x) => findings.push({ ...x, invoiceId: inv.id, invoiceExtId: inv.ext_id ?? String(inv.id), paymentId }));

  for (const inv of invoices) {
    const recorded = byInvoice.get(inv.id) ?? [];
    if (!recorded.length) continue; // nothing to compare; an invoice still waiting for approval is not history
    const requester = String(inv.requester_id);
    const v = inv.vendor_id === null ? undefined : vendors.get(inv.vendor_id);
    try {
      if (!thresholds) throw thresholdError;
      if (inv.total_cad_cents === null || !v) throw new Error("invoice has no CAD amount or no known vendor");
      const expected = routeApprovalChain(
        { totalCadCents: inv.total_cad_cents, date: inv.invoice_date },
        usersOn(inv.invoice_date).find((u) => u.id === requester)!,
        { status: v.status ?? "", category: v.category ?? "", onboardedAt: v.onboarded_at ?? undefined },
        usersOn(inv.invoice_date), departments, thresholds,
      );
      add(inv, compareApprovals(expected, recorded, { requesterId: requester, totalCadCents: inv.total_cad_cents }, limits));
    } catch (e) {
      add(inv, [{ code: "routing_failed", message: e instanceof Error ? e.message : String(e) }]);
    }
  }

  const payments = db.prepare("SELECT p.id, p.invoice_id, p.status, p.amount_cad_cents, p.prepared_by, p.released_by, p.paid_at, i.ext_id FROM payments p JOIN invoices i ON i.id = p.invoice_id ORDER BY p.id").all() as
    { id: number; invoice_id: number; status: string; amount_cad_cents: number | null; prepared_by: number | null; released_by: number | null; paid_at: string | null; ext_id: string | null }[];
  for (const p of payments) {
    const approverIds = (byInvoice.get(p.invoice_id) ?? []).filter((r) => r.decision === "approved").map((r) => r.userId);
    add({ id: p.invoice_id, ext_id: p.ext_id }, checkRelease(
      { amountCadCents: p.amount_cad_cents ?? 0, preparedBy: p.prepared_by === null ? null : String(p.prepared_by), releasedBy: p.released_by === null ? null : String(p.released_by), status: p.status, paidDate: p.paid_at },
      approverIds, limits, RELEASE_TIERS,
    ), p.id);
  }
  return { findings, invoices: invoices.length, approvals: approvals.length, payments: payments.length };
}

// The cause table: one row per cause with how many times it happened and up to 3 example invoices.
export function replayHistory(): ReplayReport {
  const { findings, invoices, approvals, payments } = replayFindings();
  const by = new Map<string, Finding[]>();
  for (const f of findings) by.set(f.code, [...(by.get(f.code) ?? []), f]);
  const causes = [...by].map(([code, list]) => ({
    code, ...describeCause(code), count: list.length, examples: [...new Set(list.map((f) => f.invoiceExtId))].slice(0, 3),
  })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { asOf: AS_OF, invoices, approvals, payments, causes };
}

export type HistoricalAnomaly = { invoiceId: number; invoiceRef: string; paymentId: number | null; code: string; label: string; reason: string; readOnly: true };

// Flagged history for the exceptions screen: only causes we agree are control failures. Read-only: no status changes.
// ponytail: recomputed on every call (ms at this size); cache or store the rows if the history grows 100x.
export function listHistoricalAnomalies(page: Page = DEFAULT_PAGE): { items: HistoricalAnomaly[]; total: number } {
  const flagged = replayFindings().findings.filter((f) => describeCause(f.code).verdict === "control_failure");
  return {
    total: flagged.length,
    items: flagged.slice(page.offset, page.offset + page.limit).map((f) => ({
      invoiceId: f.invoiceId, invoiceRef: f.invoiceExtId, paymentId: f.paymentId, code: f.code, label: describeCause(f.code).label, reason: f.message, readOnly: true as const,
    })),
  };
}

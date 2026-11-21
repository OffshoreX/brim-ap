import type { User } from "@/contracts";
import { getDb } from "./db";
import { DEFAULT_PAGE, MAX_LIMIT, type Page } from "./paging";

// Read side for the screens. Response types live here, not in contracts.ts (lead-owned).
// Every function takes the already-authorised user; roles are checked by requireRole in the route.

export class ViewError extends Error {
  constructor(public status: 400 | 404, message: string) {
    super(message);
  }
}

// The one place that says which invoices a user may see (employee: own, approver: has a step, others: all).
function visibleSql(user: User, alias = "i"): { sql: string; args: unknown[] } {
  if (user.role === "employee") return { sql: `${alias}.requester_id = ?`, args: [user.id] };
  if (user.role === "approver")
    return { sql: `${alias}.id IN (SELECT invoice_id FROM approval_steps WHERE user_id = ?)`, args: [user.id] };
  return { sql: "1 = 1", args: [] };
}

// flags is JSON text; keep objects as they are, turn bare strings into {code,message}.
function parseFlags(text: string): unknown[] {
  try {
    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw.map((f) => (typeof f === "string" ? { code: f, message: f } : f));
  } catch {
    return [{ code: "unreadable_flags", message: "Flags could not be parsed" }];
  }
}

const parseJson = (t: string | null) => {
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

export function invoiceDetail(user: User, id: number) {
  const db = getDb();
  const v = visibleSql(user);
  const inv = db
    .prepare(`SELECT i.* FROM invoices i WHERE i.id = ? AND ${v.sql}`)
    .get(id, ...v.args) as Record<string, unknown> | undefined;
  // 404 (not 403) when hidden, so an employee cannot probe which ids exist.
  if (!inv) throw new ViewError(404, "Invoice not found");
  // Bank details are left out on purpose: no screen needs them here.
  const vendor = db
    .prepare("SELECT id, name, category, status, payment_terms_days AS paymentTermsDays, province_or_state AS province, currency FROM vendors WHERE id = ?")
    .get(inv.vendor_id) ?? null;
  // The email this invoice came from, if any (written by the inbox import).
  const sourceEmail = db
    .prepare(
      `SELECT m.email_id AS emailId, m.from_address AS "from", m.subject, m.received_at AS receivedAt
       FROM invoice_email e JOIN inbox_mail m ON m.email_id = e.email_id WHERE e.invoice_id = ?`
    )
    .get(id) ?? null;
  const lines = db
    .prepare(
      `SELECT l.line_no AS lineNo, l.line_type AS lineType, l.description, l.quantity, l.unit_price_cents AS unitPriceCents,
              l.amount_cents AS amountCents, l.currency, l.tax_cents AS taxCents, l.gst_hst_code AS gstHstCode, l.pst_qst_code AS pstQstCode,
              g.code AS glCode, g.name AS glName
       FROM invoice_lines l LEFT JOIN gl_accounts g ON g.id = l.gl_account_id WHERE l.invoice_id = ? ORDER BY l.line_no, l.id`
    )
    .all(id);
  const chain = db
    .prepare(
      `SELECT s.step_no AS stepNo, s.role, s.user_id AS userId, u.name AS userName, s.delegated_from_id AS delegatedFromId, s.reason, s.status
       FROM approval_steps s LEFT JOIN users u ON u.id = s.user_id WHERE s.invoice_id = ? ORDER BY s.step_no`
    )
    .all(id);
  const approvals = db
    .prepare(
      `SELECT a.id, a.step_no AS stepNo, a.approver_id AS approverId, a.approver_role AS approverRole, a.decision, a.decided_at AS decidedAt, a.comment, a.delegated
       FROM approvals a WHERE a.invoice_id = ? ORDER BY a.id`
    )
    .all(id);
  const payments = db
    .prepare(
      `SELECT id, method, status, scheduled_date AS scheduledDate, paid_at AS paidAt, amount_cents AS amountCents, currency, reference
       FROM payments WHERE invoice_id = ? ORDER BY id`
    )
    .all(id);
  return {
    id: inv.id,
    status: inv.status,
    invoiceNumber: inv.invoice_number,
    invoiceDate: inv.invoice_date,
    dueDate: inv.due_date,
    subtotalCents: inv.subtotal_cents,
    gstHstCents: inv.gst_hst_cents,
    pstQstCents: inv.pst_qst_cents,
    totalCents: inv.total_cents,
    currency: inv.currency,
    totalCadCents: inv.total_cad_cents,
    requesterId: inv.requester_id,
    sourceFile: inv.source_file,
    sourceEmail,
    extraction: parseJson(inv.extraction_json as string | null),
    flags: parseFlags(inv.flags as string),
    vendor,
    lines,
    approvalChain: chain,
    approvals,
    payments,
  };
}

// Time-ordered audit rows for the invoice and its payments (approvals and coding are logged on the invoice).
export function invoiceTrail(invoiceId: number) {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM invoices WHERE id = ?").get(invoiceId)) throw new ViewError(404, "Invoice not found");
  const rows = db
    .prepare(
      `SELECT id, at, actor_id, action, entity, entity_id, before, after FROM audit_log
       WHERE (entity = 'invoice' AND entity_id = @id)
          OR (entity = 'payment' AND entity_id IN (SELECT CAST(id AS TEXT) FROM payments WHERE invoice_id = @n))
       ORDER BY at, id`
    )
    .all({ id: String(invoiceId), n: invoiceId });
  return rows.map(auditRow);
}

type AuditRaw = { id: number; at: string; actor_id: number | null; action: string; entity: string; entity_id: string | null; before: string | null; after: string | null };
const auditRow = (r: unknown) => {
  const a = r as AuditRaw;
  return { id: a.id, at: a.at, actorId: a.actor_id, action: a.action, entity: a.entity, entityId: a.entity_id, before: parseJson(a.before), after: parseJson(a.after) };
};

export type AuditFilter = { entity?: string; actor?: number; from?: string; to?: string; limit?: number; offset?: number };

// Filters are bound parameters, never built into the SQL text.
function auditWhere(f: AuditFilter) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.entity) { where.push("entity = ?"); args.push(f.entity); }
  if (f.actor !== undefined) { where.push("actor_id = ?"); args.push(f.actor); }
  if (f.from) { where.push("at >= ?"); args.push(f.from); }
  if (f.to) { where.push("at <= ?"); args.push(f.to); }
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", args };
}

export function countAudit(f: AuditFilter): number {
  const w = auditWhere(f);
  return (getDb().prepare(`SELECT COUNT(*) n FROM audit_log ${w.sql}`).get(...w.args) as { n: number }).n;
}

// Newest first, default 50 rows, at most 200 per page.
export function auditLog(f: AuditFilter) {
  const w = auditWhere(f);
  const limit = Math.min(f.limit ?? DEFAULT_PAGE.limit, MAX_LIMIT);
  const rows = getDb()
    .prepare(`SELECT id, at, actor_id, action, entity, entity_id, before, after FROM audit_log ${w.sql} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...w.args, limit, f.offset ?? 0);
  return rows.map(auditRow);
}

const INBOX_FROM = `FROM approval_steps s JOIN invoices i ON i.id = s.invoice_id
       WHERE s.user_id = ? AND s.status = 'pending' AND i.status = 'pending_approval'
         AND s.step_no = (SELECT MIN(step_no) FROM approval_steps WHERE invoice_id = s.invoice_id AND status = 'pending')`;

export const countApprovalInbox = (user: User) =>
  (getDb().prepare(`SELECT COUNT(*) n ${INBOX_FROM}`).get(user.id) as { n: number }).n;

// Steps whose turn it is: the lowest pending step of each pending_approval invoice, if it is this user's.
export function approvalInbox(user: User, page: Page = DEFAULT_PAGE) {
  return getDb()
    .prepare(
      `SELECT s.invoice_id AS invoiceId, s.step_no AS stepNo, s.role, s.reason, s.delegated_from_id AS delegatedFromId,
              i.invoice_number AS invoiceNumber, i.vendor_id AS vendorId, i.total_cents AS totalCents, i.currency
       ${INBOX_FROM}
       ORDER BY s.invoice_id LIMIT ? OFFSET ?`
    )
    .all(user.id, page.limit, page.offset);
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

// Counts only the invoices this user may see. Due this week = unpaid, due today through the next 6 days.
export function dashboard(user: User, today: string = todayIso()) {
  const db = getDb();
  const v = visibleSql(user);
  const byStatus: Record<string, number> = {};
  for (const r of db.prepare(`SELECT status, COUNT(*) n FROM invoices i WHERE ${v.sql} GROUP BY status`).all(...v.args) as { status: string; n: number }[])
    byStatus[r.status] = r.n;
  // An invoice with no CAD amount (foreign, not converted) adds nothing rather than a wrong number.
  const due = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(total_cad_cents, CASE WHEN currency = 'CAD' THEN total_cents END)), 0) AS c
       FROM invoices i WHERE ${v.sql} AND status NOT IN ('paid','rejected') AND due_date >= ? AND due_date <= ?`
    )
    .get(...v.args, today, addDays(today, 6)) as { c: number };
  return { countsByStatus: byStatus, needsReview: byStatus.needs_review ?? 0, dueThisWeekCadCents: due.c };
}

export const countPayments = () =>
  (getDb().prepare("SELECT COUNT(*) n FROM payments WHERE status IN ('scheduled','settled')").get() as { n: number }).n;

export function listPayments(page: Page = DEFAULT_PAGE) {
  return getDb()
    .prepare(
      `SELECT p.id, p.invoice_id AS invoiceId, i.invoice_number AS invoiceNumber, p.vendor_id AS vendorId, p.method, p.status,
              p.scheduled_date AS scheduledDate, p.paid_at AS paidAt, p.amount_cents AS amountCents, p.currency, p.reference
       FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.status IN ('scheduled','settled') ORDER BY p.id LIMIT ? OFFSET ?`
    )
    .all(page.limit, page.offset);
}

import type { User } from "@/contracts";
import { getDb } from "./db";
import { DEFAULT_PAGE, MAX_LIMIT, type Page } from "./paging";
import { chooseMethod, discountCentsFor, parseEarlyPayTerms, type PayMethod } from "./rules/paymentTerms";

// Read side for the screens. Response types live here, not in contracts.ts (lead-owned).
// Every function takes the already-authorised user; roles are checked by requireRole in the route.

export class ViewError extends Error {
  constructor(public status: 400 | 404, message: string) {
    super(message);
  }
}

// The one place that says which invoices a user may see (employee: own, approver: has a step, others: all).
export function visibleSql(user: User, alias = "i"): { sql: string; args: unknown[] } {
  if (user.role === "employee") return { sql: `${alias}.requester_id = ?`, args: [user.id] };
  if (user.role === "approver")
    return { sql: `${alias}.id IN (SELECT invoice_id FROM approval_steps WHERE user_id = ?)`, args: [user.id] };
  return { sql: "1 = 1", args: [] };
}

export type Flag = { code: string; message: string; severity: "error" | "warning" | "info" };
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

// flags is JSON text. Every flag comes out as {code,message,severity}; a bare string or a missing/unknown severity
// counts as a warning (never silently dropped). Sorted most severe first; the sort is stable, so stored order is kept within a level.
export function parseFlags(text: string): Flag[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [{ code: "unreadable_flags", message: "Flags could not be parsed", severity: "warning" }];
  }
  if (!Array.isArray(raw)) return [];
  const flags = raw.map((f): Flag => {
    const o = typeof f === "string" ? { code: f, message: f } : (f as Partial<Flag>);
    const severity = o.severity !== undefined && o.severity in SEVERITY_RANK ? o.severity : "warning";
    return { ...o, code: String(o.code ?? ""), message: String(o.message ?? o.code ?? ""), severity };
  });
  return flags.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// Plain text for the screens, so the UI never shows a raw token. Unknown values get a readable fallback.
const ROLE_LABELS: Record<string, string> = {
  employee: "Employee", approver: "Approver", dept_manager: "Department manager", ap_clerk: "AP clerk",
  finance_manager: "Finance manager", controller_admin: "Controller", cfo: "CFO", auditor: "Auditor",
};
const humanize = (t: string) => (t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).replace(/_/g, " ");
export const roleLabel = (role: string) => ROLE_LABELS[role] ?? humanize(role);
const METHOD_LABELS: Record<string, string> = { EFT: "EFT", CHEQUE: "Cheque", CARD: "Card" };
// payments.status holds scheduled, settled (money moved) and outstanding (dataset rows not yet paid); paid is the invoice-side word.
const PAYMENT_STATUS_LABELS: Record<string, string> = { scheduled: "Scheduled", settled: "Paid", paid: "Paid", outstanding: "Outstanding" };
export const methodLabel = (m: string) => METHOD_LABELS[m] ?? humanize(m);
export const paymentStatusLabel = (s: string) => PAYMENT_STATUS_LABELS[s] ?? humanize(s);

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
      `SELECT s.step_no AS stepNo, s.role, s.user_id AS userId, u.name AS userName, u.name AS actorName,
              s.delegated_from_id AS delegatedFromId, d.name AS delegatedFromName, s.reason, s.status
       FROM approval_steps s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users d ON d.id = s.delegated_from_id
       WHERE s.invoice_id = ? ORDER BY s.step_no`
    )
    .all(id)
    .map((c) => ({ ...(c as { role: string }), roleLabel: roleLabel((c as { role: string }).role) }));
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
    .all(id)
    .map((p) => ({ ...(p as { method: string; status: string }), methodLabel: methodLabel((p as { method: string }).method), statusLabel: paymentStatusLabel((p as { status: string }).status) }));
  // The latest clerk decision on a held invoice. The note lives in the audit row (written with the status change), so there is one copy.
  const res = db
    .prepare(
      `SELECT a.at, a.after, u.name AS byName FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.entity = 'invoice' AND a.entity_id = ? AND a.action = 'exception.resolve' ORDER BY a.id DESC LIMIT 1`
    )
    .get(String(id)) as { at: string; after: string | null; byName: string | null } | undefined;
  const after = res ? (parseJson(res.after) as { note?: string; action?: string } | null) : null;
  const resolution = res ? { note: after?.note ?? "", byName: res.byName ?? "System", at: res.at, action: after?.action ?? "" } : null;
  return {
    id: inv.id,
    status: inv.status,
    invoiceNumber: inv.invoice_number,
    vendorId: inv.vendor_id,
    vendorName: (vendor as { name: string } | null)?.name ?? null,
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
    resolution,
  };
}

// Time-ordered audit rows for the invoice and its payments (approvals and coding are logged on the invoice).
export function invoiceTrail(invoiceId: number) {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM invoices WHERE id = ?").get(invoiceId)) throw new ViewError(404, "Invoice not found");
  const rows = db
    .prepare(
      `SELECT ${AUDIT_COLS} FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE (entity = 'invoice' AND entity_id = @id)
          OR (entity = 'payment' AND entity_id IN (SELECT CAST(id AS TEXT) FROM payments WHERE invoice_id = @n))
       ORDER BY at, a.id`
    )
    .all({ id: String(invoiceId), n: invoiceId });
  return rows.map(auditRow);
}

// actor_name is NULL for system rows (no actor) and for a deleted user; both print as "System" rather than a bare id.
const AUDIT_COLS = "a.id, a.at, a.actor_id, u.name AS actor_name, a.action, a.entity, a.entity_id, a.before, a.after";
type AuditRaw = { id: number; at: string; actor_id: number | null; actor_name: string | null; action: string; entity: string; entity_id: string | null; before: string | null; after: string | null };
const auditRow = (r: unknown) => {
  const a = r as AuditRaw;
  return { id: a.id, at: a.at, actorId: a.actor_id, actorName: a.actor_name ?? "System", action: a.action, entity: a.entity, entityId: a.entity_id, before: parseJson(a.before), after: parseJson(a.after) };
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
    .prepare(`SELECT ${AUDIT_COLS} FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ${w.sql} ORDER BY at DESC, a.id DESC LIMIT ? OFFSET ?`)
    .all(...w.args, limit, f.offset ?? 0);
  return rows.map(auditRow);
}

const CSV_BATCH = 1000;
const CSV_HEAD = ["id", "at", "actor_id", "action", "entity", "entity_id", "before", "after", "prev_hash", "row_hash"];
type CsvRow = Record<string, string | number | null>;

// Text cells are always quoted. A leading = + - @ would run as a formula in Excel, so those get a ' in front.
const csvCell = (v: string | number | null) =>
  v === null ? "" : typeof v === "number" ? String(v) : `"${(/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"`;

// Oldest first, in batches of 1000 rows keyed on (at, id), so memory stays flat however big the log is and the existing
// (entity|actor, at) indexes serve the sort. Each pull reads one batch; nothing holds a cursor open between pulls.
export function auditCsvStream(f: AuditFilter): ReadableStream<Uint8Array> {
  const w = auditWhere(f);
  const stmt = getDb().prepare(
    `SELECT ${CSV_HEAD.join(", ")} FROM audit_log ${w.sql ? w.sql + " AND" : "WHERE"} (at, id) > (?, ?) ORDER BY at, id LIMIT ${CSV_BATCH}`
  );
  const enc = new TextEncoder();
  let after: [string, number] = ["", 0];
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(CSV_HEAD.join(",") + "\r\n"));
    },
    pull(c) {
      const rows = stmt.all(...w.args, ...after) as CsvRow[];
      if (rows.length) {
        c.enqueue(enc.encode(rows.map((r) => CSV_HEAD.map((k) => csvCell(r[k])).join(",")).join("\r\n") + "\r\n"));
        const last = rows[rows.length - 1];
        after = [last.at as string, last.id as number];
      }
      if (rows.length < CSV_BATCH) c.close();
    },
  });
}

const INBOX_FROM = `FROM approval_steps s JOIN invoices i ON i.id = s.invoice_id LEFT JOIN vendors v ON v.id = i.vendor_id
       WHERE s.user_id = ? AND s.status = 'pending' AND i.status = 'pending_approval'
         AND s.step_no = (SELECT MIN(step_no) FROM approval_steps WHERE invoice_id = s.invoice_id AND status = 'pending')`;

export const countApprovalInbox = (user: User) =>
  (getDb().prepare(`SELECT COUNT(*) n ${INBOX_FROM}`).get(user.id) as { n: number }).n;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// Steps whose turn it is: the lowest pending step of each pending_approval invoice, if it is this user's.
// Carries what the approver needs to decide at a glance: vendor name, dates, age (days since received, as of asOf) and the worst flag.
export function approvalInbox(user: User, page: Page = DEFAULT_PAGE, asOf: string = todayIso()) {
  const rows = getDb()
    .prepare(
      `SELECT s.invoice_id AS invoiceId, s.step_no AS stepNo, s.role, s.reason, s.delegated_from_id AS delegatedFromId,
              i.invoice_number AS invoiceNumber, i.vendor_id AS vendorId, v.name AS vendorName, i.total_cents AS totalCents, i.currency,
              i.invoice_date AS invoiceDate, i.due_date AS dueDate, COALESCE(i.received_date, i.invoice_date) AS receivedOn,
              i.total_cad_cents AS totalCadCents, i.flags
       ${INBOX_FROM}
       ORDER BY s.invoice_id LIMIT ? OFFSET ?`
    )
    .all(user.id, page.limit, page.offset) as (Record<string, unknown> & { totalCents: number; totalCadCents: number | null; receivedOn: string; flags: string })[];
  return rows.map(({ receivedOn, flags, ...r }) => {
    const all = parseFlags(flags);
    const top = all[0];
    // Never negative: a received date after the as-of date is treated as arriving today.
    return { ...r, ageDays: Math.max(0, daysBetween(receivedOn, asOf)), flagCount: all.length, topFlag: top ? { code: top.code, severity: top.severity, message: top.message } : null };
  });
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
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.invoice_id AS invoiceId, i.invoice_number AS invoiceNumber, p.vendor_id AS vendorId, v.name AS vendorName,
              i.total_cents AS invoiceTotalCents, p.method, p.status,
              p.scheduled_date AS scheduledDate, p.paid_at AS paidAt, p.amount_cents AS amountCents, p.currency, p.reference
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN vendors v ON v.id = p.vendor_id
       WHERE p.status IN ('scheduled','settled') ORDER BY p.id LIMIT ? OFFSET ?`
    )
    .all(page.limit, page.offset) as { method: string; status: string }[];
  return rows.map((r) => ({ ...r, methodLabel: methodLabel(r.method), statusLabel: paymentStatusLabel(r.status) }));
}

const READY_FROM = "FROM invoices i LEFT JOIN vendors v ON v.id = i.vendor_id WHERE i.status = 'approved' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)";
export const countReadyToPay = () => (getDb().prepare(`SELECT COUNT(*) n ${READY_FROM}`).get() as { n: number }).n;

// Approved invoices with no payment yet, i.e. what Prepare payment can act on. The suggested method is the same
// chooseMethod answer preparePayment uses, with a plain reason. The discount shows only while the window is open on asOf.
export function readyToPay(page: Page = DEFAULT_PAGE, asOf: string = todayIso()) {
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invoiceId, i.invoice_number AS invoiceNumber, v.name AS vendorName, i.total_cents AS totalCents, i.currency,
              i.due_date AS dueDate, i.invoice_date AS invoiceDate, i.subtotal_cents AS subtotalCents,
              v.preferred_payment_method AS preferred, v.accepts_card_payment AS card, v.early_pay_discount AS terms
       ${READY_FROM} ORDER BY i.id LIMIT ? OFFSET ?`
    )
    .all(page.limit, page.offset) as {
    invoiceId: number; invoiceNumber: string; vendorName: string | null; totalCents: number; currency: string; dueDate: string | null;
    invoiceDate: string; subtotalCents: number | null; preferred: PayMethod | null; card: number | null; terms: string | null;
  }[];
  return rows.map((r) => {
    const choice = chooseMethod(r.preferred, r.card === 1);
    const method = choice.ok ? choice.method : "EFT";
    const reason = choice.ok && choice.note ? choice.note : r.preferred ? `Vendor's preferred method is ${methodLabel(method)}` : "No preferred method on file; EFT is the default";
    const discount = discountCentsFor(parseEarlyPayTerms(r.terms), r.invoiceDate, asOf, r.subtotalCents ?? 0);
    return {
      invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, vendorName: r.vendorName, totalCents: r.totalCents, currency: r.currency, dueDate: r.dueDate,
      suggestedMethod: { method, label: methodLabel(method), reason },
      earlyPayDiscountCents: discount > 0 ? discount : null,
    };
  });
}

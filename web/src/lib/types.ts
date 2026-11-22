// Response shapes. Section 1 was written from the real JSON of each endpoint (called with curl as each role).
// Section 2 is still the design tool's guess: later tickets replace it page by page. Money is integer cents + currency.

// ---------- 1. Verified against the real server ----------

export type Role = "employee" | "ap_clerk" | "approver" | "finance_manager" | "controller_admin" | "auditor";

// GET /api/me -> { user }. (POST /api/login returns only { user: { id, name, role } }, so the app always re-reads /me.)
export interface Me {
  id: number;
  name: string;
  email: string;
  title: string | null;
  role: Role;
}

// The seven values of invoices.status in the database. There is no "blocked" or "processing" status;
// "blocked" is shown from flags with severity "error".
export const INVOICE_STATUSES = ["received", "needs_review", "pending_approval", "approved", "scheduled", "paid", "rejected"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type FlagSeverity = "error" | "warning" | "info";
export interface Flag {
  code: string;
  message: string;
  severity: FlagSeverity;
}

// One row of GET /api/invoices (newest first). The server sends no vendor name or due date here.
export interface InvoiceListItem {
  id: number;
  status: InvoiceStatus;
  vendorId: number | null;
  invoiceNumber: string;
  invoiceDate: string;
  totalCents: number;
  currency: string;
  requesterId: number | null;
  sourceFile: string | null;
}
// What the list page shows: the row plus fields api.ts fills in from the invoice detail (null if that call failed).
export interface InvoiceRow extends InvoiceListItem {
  vendorName: string | null;
  dueDate: string | null;
  flagCount: number | null;
}

export interface InvoiceLine {
  lineNo: number;
  lineType: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  currency: string;
  taxCents: number | null;
  gstHstCode: string | null;
  pstQstCode: string | null;
  glCode: string | null;
  glName: string | null;
}

// Who is asked to approve, in order. Empty for old invoices that were approved before chains were stored.
export interface ApprovalChainStep {
  stepNo: number;
  role: string;
  roleLabel: string;
  userId: number;
  userName: string | null;
  delegatedFromId: number | null;
  delegatedFromName: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "skipped";
}
// A decision that was made. approverRole can be an older role name such as dept_manager.
export interface ApprovalDecision {
  id: number;
  stepNo: number;
  approverId: number;
  approverRole: string;
  decision: "approved" | "rejected";
  decidedAt: string | null;
  comment: string | null;
  delegated: number;
}

export interface InvoicePayment {
  id: number;
  method: string;
  methodLabel: string;
  status: string;
  statusLabel: string;
  scheduledDate: string | null;
  paidAt: string | null;
  amountCents: number;
  currency: string;
  reference: string | null;
}

export interface InvoiceDetail {
  id: number;
  status: InvoiceStatus;
  invoiceNumber: string;
  vendorId: number | null;
  vendorName: string | null;
  invoiceDate: string;
  dueDate: string | null;
  subtotalCents: number | null;
  gstHstCents: number | null;
  pstQstCents: number | null;
  totalCents: number;
  currency: string;
  totalCadCents: number | null;
  requesterId: number | null;
  sourceFile: string | null;
  sourceEmail: { emailId: string; from: string; subject: string; receivedAt: string } | null;
  extraction: unknown;
  flags: Flag[];
  vendor: { id: number; name: string; category: string | null; status: string; paymentTermsDays: number | null; province: string | null; currency: string } | null;
  lines: InvoiceLine[];
  approvalChain: ApprovalChainStep[];
  approvals: ApprovalDecision[];
  payments: InvoicePayment[];
}

// GET /api/invoices/counts. Same visibility as the list, so each count equals that status's X-Total-Count.
export interface InvoiceCounts {
  total: number;
  byStatus: Record<InvoiceStatus, number>;
}

// GET /api/dashboard (also scoped to what the role may see). Only the CAD total for invoices due in the next 7 days.
export interface Dashboard {
  countsByStatus: Partial<Record<InvoiceStatus, number>>;
  needsReview: number;
  dueThisWeekCadCents: number;
}

// GET /api/invoices/:id/trail and /api/audit rows. before/after are the parsed JSON the server stored.
export interface TrailEntry {
  id: number;
  at: string;
  actorId: number | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

// GET /api/invoices/:id/process-log and /api/process-log (the second also carries invoiceId and invoiceNumber).
export interface ProcessStep {
  id: number;
  step: string;
  status: "ok" | "flagged" | "failed" | "skipped";
  detail: string;
  durationMs: number;
  createdAt: string;
  invoiceId?: number;
  invoiceNumber?: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

// Reports: api.ts reshapes the real rows ({bucket, invoices, totalCadCents} and {key, invoices, totalCadCents}) into these.
export interface AgingBucket {
  label: string;
  amountCents: number;
  count: number;
}
export interface AgingReport {
  currency: string;
  buckets: AgingBucket[];
}
export const SPEND_BY = ["vendor", "department", "month"] as const;
export type SpendBy = (typeof SPEND_BY)[number];
export interface SpendRow {
  label: string; // vendor name, department or yyyy-mm, depending on SpendBy
  amountCents: number;
  count: number;
}
// total = how many groups exist (X-Total-Count), so the page can say "top 8 of 52".
export interface SpendReport {
  currency: string;
  rows: SpendRow[];
  total: number;
}
// GET /api/reports/discounts: one row per vendor with early-pay terms. Amounts are CAD cents.
export interface DiscountRow {
  vendor: string;
  terms: string;
  takenPayments: number;
  takenCadCents: number;
  missedPayments: number;
  missedCadCents: number;
}

// GET /api/vendors and /api/vendors/:id. Column names are the database's (snake_case); the server never sends the full
// account number, only bank_account_last4. Money fields do not exist on a vendor.
export interface Vendor {
  id: number;
  ext_id: string;
  name: string;
  category: string | null;
  default_gl_account: string | null;
  address: string | null;
  province_or_state: string | null;
  country: string | null;
  gst_hst_number: string | null;
  qst_number: string | null;
  payment_terms_days: number | null;
  early_pay_discount: string | null;
  preferred_payment_method: string | null;
  accepts_card_payment: number;
  bank_institution: string | null;
  bank_transit: string | null;
  bank_details_updated_at: string | null;
  ap_contact_email: string | null;
  requires_po: number;
  status: "active" | "on_hold" | "pending_review" | string;
  onboarded_at: string | null;
  currency: string;
  bank_account_last4: string;
}
// One row of vendor_bank_changes. status: pending (waiting for a callback), applied (verified) or rejected.
export interface BankChange {
  id: number;
  changed_at: string;
  changed_by_user_id: number | null;
  request_channel: string | null;
  status: "pending" | "applied" | "rejected" | string;
  verified_by_callback: number;
  old_account_last4: string | null;
  new_account_last4: string | null;
  verified_by_user_id: number | null;
  verified_at: string | null;
}
export interface VendorDetail extends Vendor {
  bankChanges: BankChange[];
}

// GET /api/reconciliation?category=&limit=&offset= -> { summary, total, rows }. One row per payment or per bank/card line.
export const RECON_CATEGORIES = ["matched", "payment_unmatched", "payment_ambiguous", "amount_diff", "duplicate", "bank_no_payment", "card_no_payment"] as const;
export type ReconCategory = (typeof RECON_CATEGORIES)[number];
export interface ReconRow {
  category: ReconCategory;
  paymentId: number | null;
  invoiceNumber: string | null;
  vendor: string | null;
  method: string | null;
  paymentCents: number | null;
  lineSource: "bank" | "card" | null;
  lineId: string | null;
  lineText: string | null;
  lineDate: string | null;
  lineCents: number | null;
  diffCents: number | null;
  note: string;
}
export interface Reconciliation {
  summary: Record<ReconCategory, number>;
  total: number; // rows matching the category filter
  rows: ReconRow[];
}
// POST /api/reconciliation: saves the result; changed = payments whose reconciliation status changed.
export interface ReconciliationRun {
  changed: number;
  summary: Record<ReconCategory, number>;
}

// GET /api/audit rows are the same shape as TrailEntry. GET /api/audit/verify returns one of these two.
export type AuditVerify = { ok: true; rowCount: number; headHash: string } | { ok: false; rowCount: number; brokenAtId: number; reason: string };

// GET /api/admin/approval-rules -> { rules }. Only over_cents can be changed (PUT). Thresholds compare to the invoice's CAD total.
export interface ApprovalRule {
  id: number;
  policy_id: string | null;
  over_cents: number;
  extra_role: string; // finance_manager, controller_admin or cfo (cfo is not a login role)
}

// ---------- 1b. Approvals, exceptions, payments, upload (verified by calling each endpoint as each role) ----------

// GET /api/approvals/inbox -> X-Total-Count + rows for the invoices where the caller is the next approver.
// There is no flags array here, only the worst flag (topFlag) and a count. role is the raw step role (for example dept_manager).
export interface InboxItem {
  invoiceId: number;
  stepNo: number;
  role: string;
  reason: string;
  delegatedFromId: number | null;
  invoiceNumber: string;
  vendorId: number | null;
  vendorName: string | null;
  totalCents: number;
  currency: string;
  invoiceDate: string;
  dueDate: string | null;
  totalCadCents: number | null;
  ageDays: number;
  flagCount: number;
  topFlag: Flag | null;
}

// POST /api/invoices/:id/decision
export interface DecisionResult {
  invoiceId: number;
  status: InvoiceStatus;
  decision: "approved" | "rejected";
  stepNo: number;
  nextApproverId: number | null;
  delegated: boolean;
  delegatedFromId: number | null;
}

// GET /api/exceptions rows (invoices in needs_review). The flags have no severity and there is no vendor name or due date.
export interface ExceptionListItem {
  id: number;
  invoiceNumber: string;
  vendorId: number | null;
  totalCents: number;
  currency: string;
  flags: { code: string; message: string }[];
}
// What the Exceptions page shows: the row plus vendor name, due date and flags with severity, taken from the invoice detail.
export interface ExceptionRow {
  id: number;
  invoiceNumber: string;
  vendorId: number | null;
  vendorName: string | null;
  dueDate: string | null;
  totalCents: number;
  currency: string;
  flags: Flag[];
}
// POST /api/exceptions/:id/resolve
export interface ResolveResult {
  invoiceId: number;
  status: "pending_approval" | "rejected";
}

// GET /api/exceptions/historical: anomalies found in past invoices. Read-only; nobody can act on them.
export interface HistoricalException {
  invoiceId: number;
  invoiceRef: string;
  paymentId: number | null;
  code: string;
  label: string;
  reason: string;
  readOnly: true;
}

// GET /api/inbox/other: mail that did not become an invoice by itself (statements, questions, odd attachments).
export interface OtherInboxEmail {
  emailId: string;
  from: string;
  subject: string;
  receivedAt: string;
  class: string;
  reason: string | null;
  attachments: string[];
  flags: string[];
}
// POST /api/inbox/import answers one row per email. invoiceIds is empty when the email was skipped (skipped says why).
export interface ImportRow {
  emailId: string;
  class: string;
  invoiceIds: number[];
  flags: string[];
  skipped?: string;
}

// GET /api/payments/ready: approved invoices with no payment yet. suggestedMethod is the server's pick and its reason.
export interface ReadyToPay {
  invoiceId: number;
  invoiceNumber: string;
  vendorName: string | null;
  totalCents: number;
  currency: string;
  dueDate: string | null;
  suggestedMethod: { method: string; label: string; reason: string };
  earlyPayDiscountCents: number | null;
}
// POST /api/payments/prepare
export interface PrepareResult {
  paymentId: number;
  invoiceId: number;
  status: "scheduled";
  method: string;
  scheduledDate: string;
  earlyPay: boolean;
  notes: string[];
}

// GET /api/payments (all payments, oldest first by id, so a payment prepared today is on the last page). status is scheduled | settled | outstanding (a cheque not yet cashed);
// method is EFT | CARD | CHEQUE. methodLabel and statusLabel are the server's words for them.
export interface Payment {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  vendorId: number | null;
  vendorName: string | null;
  invoiceTotalCents: number;
  method: string;
  status: string;
  scheduledDate: string | null;
  paidAt: string | null;
  amountCents: number;
  currency: string;
  reference: string | null;
  methodLabel: string;
  statusLabel: string;
}
// POST /api/payments/release
export interface ReleaseResult {
  paymentId: number;
  invoiceId: number;
  status: "paid";
  method: string;
  reference: string;
  discountCents: number;
}

// POST /api/invoices/upload answers only when every file has been through the whole pipeline. A file the server refuses
// comes back inside a 200 as { invoiceId: null, status: "error", error }, so callers must read error, not just the HTTP status.
export interface UploadFileResult {
  file: string;
  invoiceId: number | null;
  status: string;
  flags: Flag[];
  error: string | null;
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}


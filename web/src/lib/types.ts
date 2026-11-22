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
export interface SpendRow {
  vendorName: string;
  amountCents: number;
}
export interface SpendReport {
  currency: string;
  rows: SpendRow[];
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

// ---------- 2. Not yet checked against the server (owned by the tickets for those pages) ----------

export interface Reconciliation {
  periodLabel: string;
  matchedCount: number;
  unmatchedCount: number;
  matchedCents: number;
  unmatchedCents: number;
  currency: string;
  lastRunAt: string | null;
}

export interface DiscountRow {
  invoiceNumber: string;
  vendorName: string;
  discountCents: number;
  deadline: string;
  captured: boolean;
}
export interface DiscountReport {
  currency: string;
  rows: DiscountRow[];
}

export interface Vendor {
  id: string;
  name: string;
  email: string | null;
  paymentMethod: "eft" | "cheque";
  bankLast4: string | null;
  status: "active" | "on_hold";
  pendingBankChange: boolean;
}

export interface BankChangeRequest {
  id: string;
  requestedBy: string;
  requestedAt: string;
  newBankLast4: string;
  status: "pending_verification" | "verified" | "rejected";
}

export interface VendorDetail extends Vendor {
  address: string | null;
  bankChange: BankChangeRequest | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorName: string;
  action: string;
  entity: string;
  hash: string;
}

export interface AuditVerify {
  ok: boolean;
  checked: number;
  message: string;
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface ApprovalRule {
  id: string;
  name: string;
  minCents: number;
  maxCents: number | null;
  currency: string;
  approverRole: Role;
  steps: number;
}

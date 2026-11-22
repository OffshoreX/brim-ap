// Verify against the backend's src/contracts.ts
// All API response shapes live here. Money is always integer cents + ISO currency code.

export type Role =
  | "employee"
  | "ap_clerk"
  | "approver"
  | "finance_manager"
  | "controller_admin"
  | "auditor";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type InvoiceStatus =
  | "received"
  | "processing"
  | "needs_review"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "blocked"
  | "scheduled"
  | "paid";

export type FlagSeverity = "block" | "warn" | "info";

export interface Flag {
  id: string;
  code: string;
  severity: FlagSeverity;
  reason: string;
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  vendorId: string;
  vendorName: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  totalCents: number;
  currency: string;
  flagCount?: number;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  glAccount: string | null;
  costCenter: string | null;
}

export interface ApprovalStep {
  id: string;
  order: number;
  approverName: string;
  approverRole: Role;
  status: "pending" | "approved" | "rejected" | "waiting";
  decidedAt: string | null;
  comment: string | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  subtotalCents: number;
  taxCents: number;
  paymentMethod: "eft" | "cheque" | "card" | null;
  flags: Flag[];
  lines: InvoiceLine[];
  approvals: ApprovalStep[];
}

export interface TrailEntry {
  id: string;
  at: string;
  actorName: string;
  action: string;
  detail: string | null;
}

export interface ProcessStep {
  id: string;
  at: string;
  step: string;
  status: "ok" | "warn" | "error" | "running";
  message: string;
  invoiceId?: string;
}

export interface InvoiceCounts {
  total: number;
  byStatus: Partial<Record<InvoiceStatus, number>>;
}

export interface InboxItem extends InvoiceSummary {
  ageDays: number;
  flags: Flag[];
  whyYou: string;
}

export interface ExceptionItem {
  id: string;
  invoice: InvoiceSummary;
  flags: Flag[];
  createdAt: string;
}

export interface HistoricalException {
  id: string;
  invoiceNumber: string;
  vendorName: string;
  resolution: "sent_to_approval" | "rejected";
  resolvedBy: string;
  resolvedAt: string;
  note: string | null;
}

export interface OtherInboxEmail {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  reason: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  amountCents: number;
  currency: string;
  method: "eft" | "cheque";
  status: "prepared" | "scheduled" | "released" | "settled" | "failed";
  scheduledFor: string | null;
}

export interface ReadyToPay extends InvoiceSummary {
  method: "eft" | "cheque";
}

export interface Reconciliation {
  periodLabel: string;
  matchedCount: number;
  unmatchedCount: number;
  matchedCents: number;
  unmatchedCents: number;
  currency: string;
  lastRunAt: string | null;
}

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

export interface Dashboard {
  reconciliation: Reconciliation;
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

export interface Paged<T> {
  items: T[];
  total: number;
}

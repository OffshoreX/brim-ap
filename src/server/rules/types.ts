// Local input types so the rules do not depend on the DB schema.
export type Severity = 'error' | 'warning';
export type Finding = { code: string; message: string; severity: Severity };

export type Line = { totalCents: number };
export type Tax = { amountCents: number };

export type InvoiceKey = {
  id?: string;
  vendorId: string;
  number: string;
  totalCents: number;
  date: string; // ISO yyyy-mm-dd
  kind?: 'invoice' | 'credit_note';
};

// Approval routing inputs.
export type ApprovalUser = {
  id: string;
  role: string;
  managerId?: string;
  limitCents: number; // largest invoice this person may approve
  onLeave?: boolean;
  delegateId?: string;
};
export type ApprovalInvoice = { totalCents: number; department: string };
// Amount range is [minCents, maxCents); department omitted means any.
export type ApprovalRule = { minCents: number; maxCents: number; department?: string; approverRole: string };
export type ApprovalResult =
  | { status: 'routed'; approverId: string; delegated: boolean; delegatedFromId?: string; reason: string }
  | { status: 'needs_review'; reason: string };

// Coding suggestion inputs: one past coded invoice.
export type CodedInvoice = { vendorId: string; accountCode: string; taxCode: string };
export type CodingResult =
  | { status: 'suggested'; accountCode: string; taxCode: string; confidence: number; reason: string }
  | { status: 'none'; reason: string };

// Payment release inputs. Roles are plain strings so this file stays independent of contracts.
// Tiers are ascending; upToCents null means no upper bound. A payment uses the first tier it fits.
export type ReleaseTier = { upToCents: number | null; roles: readonly string[] };
export type ReleaseUser = { id: number; role: string };
// amountCadCents is what the tiers compare; approverIds are everyone who approved the invoice.
export type ReleasePayment = { amountCadCents: number; approverIds: readonly number[]; preparedBy: number | null };
export type ReleaseResult = { allowed: true } | { allowed: false; reason: string };

// Bank-detail change check inputs.
export type BankDetails = { accountNumber: string; routingNumber?: string };
// `since` is the ISO date (yyyy-mm-dd) these details were first recorded for the vendor.
export type BankRecord = BankDetails & { since: string };

// Local input types so the rules do not depend on the DB schema.
export type Severity = 'error' | 'warning' | 'info'; // info is shown but never holds an invoice
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

// Coding inputs: one past coded line of the vendor (invoiceId counts how many invoices the history spans).
export type CodedLine = { invoiceId: number; description: string; accountCode: string };
export type CodingResult =
  | { status: 'coded'; source: 'history_description' | 'history_overall' | 'vendor_default'; accountCode: string; reason: string }
  | { status: 'coding_needed'; reason: string };

// Payment release inputs. Roles are plain strings so this file stays independent of contracts.
// Tiers are ascending; upToCents null means no upper bound. A payment uses the first tier it fits.
export type ReleaseTier = { upToCents: number | null; roles: readonly string[] };
export type ReleaseUser = { id: number; role: string };
// amountCadCents is what the tiers compare; approverIds are everyone who approved the invoice.
export type ReleasePayment = { amountCadCents: number; approverIds: readonly number[]; preparedBy: number | null };
// code is the machine-readable cause (the replay groups by it); reason is the sentence a person reads.
export type ReleaseDenial = "role" | "amount" | "no_tier" | "size" | "approver" | "preparer";
export type ReleaseResult = { allowed: true } | { allowed: false; reason: string; code: ReleaseDenial };

// Bank-detail change check inputs.
export type BankDetails = { accountNumber: string; routingNumber?: string };
// `since` is the ISO date (yyyy-mm-dd) these details were first recorded for the vendor.
export type BankRecord = BankDetails & { since: string };

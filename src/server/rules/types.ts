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

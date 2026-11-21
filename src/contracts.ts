// Shared types and API shapes. Changes go through the lead.
export const ROLES = [
  "employee",
  "ap_clerk",
  "approver",
  "finance_manager",
  "controller_admin",
  "auditor",
] as const;

export type Role = (typeof ROLES)[number];

export interface User {
  id: number;
  name: string;
  role: Role;
  manager_id: number | null;
  approval_limit_cents: number;
  province: string | null;
}

export interface ApiError {
  error: string;
}

// GET /api/me, POST /api/login (body: { userId }) and GET /api/users
export type MeResponse = { user: User };
export type UsersResponse = { users: Pick<User, "id" | "name" | "role">[] };

// Domain types. Money is integer cents plus a currency code.
export const CURRENCIES = ["CAD", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const INVOICE_STATUSES = [
  "received",
  "needs_review",
  "pending_approval",
  "approved",
  "rejected",
  "paid",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface Vendor {
  id: number;
  name: string;
  tax_id: string | null;
  province: string | null;
  currency: Currency;
  bank_details: string | null;
}

export interface VendorBankHistory {
  id: number;
  vendor_id: number;
  bank_details: string;
  changed_at: string;
  changed_by: number | null;
}

export interface Contract {
  id: number;
  vendor_id: number;
  unit_price_cents: number;
  currency: Currency;
  start_date: string;
  end_date: string;
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  vendor_id: number;
  total_cents: number;
  currency: Currency;
}

export interface GlAccount {
  id: number;
  code: string;
  name: string;
}

export interface TaxCode {
  id: number;
  code: string;
  province: string | null;
  rate_bps: number;
}

export interface Invoice {
  id: number;
  status: InvoiceStatus;
  vendor_id: number | null;
  invoice_number: string;
  invoice_date: string;
  total_cents: number;
  currency: Currency;
  requester_id: number | null;
  po_id: number | null;
  flags: string; // JSON text: array of flag reasons
}

export interface InvoiceLine {
  id: number;
  invoice_id: number;
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
  currency: Currency;
  gl_account_id: number | null;
  tax_code_id: number | null;
}

export interface Approval {
  id: number;
  invoice_id: number;
  approver_id: number;
  decision: "approved" | "rejected";
  decided_at: string;
  comment: string | null;
}

export interface Payment {
  id: number;
  invoice_id: number;
  amount_cents: number;
  currency: Currency;
  released_by: number | null;
  paid_at: string;
}

// The one place that turns server codes into words. Looks only: the server still decides everything.
// Unknown values fall back to a humanised string ("part_paid" -> "Part paid"), never the raw code.
export function humanise(code: string | null | undefined): string {
  const t = (code ?? "").replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "Unknown";
}
const pick = (table: Record<string, string>) => (code: string | null | undefined) => (code && table[code]) || humanise(code);

// Both the user roles and the approval-chain roles the server sends.
export const roleName = pick({
  employee: "Employee", ap_clerk: "Clerk", approver: "Approver", finance_manager: "Finance manager", controller_admin: "Controller", auditor: "Auditor",
  dept_manager: "Department manager", cfo: "CFO",
});

// Titles for the flag codes in src/server/rules/**. The flag's own message (the reason) is shown beside it.
export const flagTitle = pick({
  DUPLICATE_EXACT: "Duplicate invoice", DUPLICATE_NEAR: "Possible duplicate", possible_duplicate: "Possible duplicate", possible_duplicate_attachments: "Possible duplicate attachment",
  POSSIBLE_SPLIT_INVOICE: "Possible split invoice",
  tax_mismatch: "Tax does not match", bad_tax: "Tax does not match", NON_INTEGER_CENTS: "Amounts are not whole cents", EMPTY_LINES: "No line items", UNKNOWN_PROVINCE: "Unknown province",
  TAX_PLACE_ASSUMED: "Place of supply assumed", TAX_MATCHES_OTHER_PROVINCE: "Tax matches another province",
  po_missing: "No purchase order", po_wrong_vendor: "Purchase order is for another vendor", po_fully_billed: "Purchase order fully billed", po_total_exceeded: "Above purchase order total", po_fx_unknown: "Cannot convert to PO currency",
  contract_price_exceeded: "Above contract price",
  bank_no_history: "No bank details on file", bank_never_seen: "Bank details never seen", bank_changed_recently: "Bank details changed recently", bank_details_differ: "Bank details differ",
  bank_change_unverified: "Bank change not verified", bank_master_updated_recently: "Vendor bank details updated recently", bank_details_changed: "Bank details changed",
  vendor_on_hold: "Vendor on hold", vendor_pending_review: "Vendor pending review",
  department_over_budget: "Department over budget", amount_outlier: "Unusual amount for this vendor", payment_terms_differ: "Payment terms differ",
  NOT_A_CREDIT_NOTE: "Not a valid credit note", CREDIT_NOTE_NO_ORIGINAL: "Credit note has no original invoice", CREDIT_NOTE_VENDOR_MISMATCH: "Credit note vendor differs", CREDIT_NOTE_EXCEEDS_ORIGINAL: "Credit exceeds the original invoice",
  missing_attachment: "No attachment", unreadable_flags: "Flags could not be read", routing_failed: "Approval routing failed",
});

export const inboxClass = pick({
  invoice: "Invoice", credit_note: "Credit note", bank_change: "Bank-change request", suspicious: "Suspicious", statement: "Statement",
  payment_inquiry: "Payment question", marketing: "Marketing", invoice_missing_attachment: "Invoice without attachment", already_imported: "Already imported",
});

export const vendorStatus = pick({ active: "Active", on_hold: "On hold", pending_review: "Pending review", inactive: "Inactive" });
export const bankChangeStatus = pick({ pending: "Waiting for a callback", verified: "Verified", applied: "Verified and applied", rejected: "Rejected" });

// Names for the processing steps the pipeline writes (src/server/pipeline.ts). The step's own sentence is shown beside it.
export const stepName = pick({
  extract: "Read the invoice", vendor_match: "Match the vendor", payment_terms: "Check payment terms", currency_conversion: "Convert currency", tax: "Check tax",
  duplicates: "Look for duplicates", bank: "Check bank details", po_match: "Match the purchase order", contract_match: "Match the contract price", split: "Look for split invoices",
  cross_payment: "Check other payments", budget_anomaly: "Check budget and usual amount", coding: "Suggest coding", approval_routing: "Route for approval",
});

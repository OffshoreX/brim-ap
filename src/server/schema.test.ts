import { expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { applySchema } from "./db";

// For every dataset CSV: our table, and the columns we deliberately named differently (csv column -> table column).
// A CSV column not listed here must exist in the table under the same name.
const MAP: Record<string, [string, Record<string, string>]> = {
  "users.csv": ["users", { user_id: "ext_id", full_name: "name", approval_limit_cad: "approval_limit_cents", work_province: "province" }],
  "departments.csv": ["departments", { department_id: "ext_id", annual_budget_cad: "annual_budget_cents" }],
  "vendors.csv": ["vendors", { vendor_id: "ext_id", legal_name: "name" }],
  "bank_change_history.csv": ["vendor_bank_changes", { change_id: "ext_id" }],
  "contracts.csv": [
    "contracts",
    { contract_id: "ext_id", monthly_fee: "monthly_fee_cents", hourly_rate_cap: "hourly_rate_cap_cents", not_to_exceed_monthly: "not_to_exceed_monthly_cents" },
  ],
  "purchase_orders.csv": ["purchase_orders", { po_id: "po_number", total_amount: "total_cents" }],
  "gl_accounts.csv": ["gl_accounts", { account_number: "code" }],
  "tax_codes.csv": ["tax_codes", { rate: "rate_bps" }], // 0.09975 -> 997.5 basis points
  "invoices.csv": [
    "invoices",
    {
      invoice_id: "ext_id", vendor_invoice_number: "invoice_number", requester_user_id: "requester_id", subtotal: "subtotal_cents",
      gst_hst_amount: "gst_hst_cents", pst_qst_amount: "pst_qst_cents", total: "total_cents", fx_rate_to_cad: "fx_rate_to_cad_bps",
      total_cad: "total_cad_cents", po_id: "po_id", // dataset po_id is a PO number; we store the purchase_orders row id
    },
  ],
  "invoice_lines.csv": [
    "invoice_lines",
    { unit_price: "unit_price_cents", amount: "amount_cents", gl_account: "gl_account_id" }, // gl_account is an account number; we store the gl_accounts row id
  ],
  "approvals.csv": ["approvals", { approval_id: "ext_id", approver_user_id: "approver_id", action: "decision", acted_at: "decided_at" }],
  "payments.csv": [
    "payments",
    {
      payment_id: "ext_id", paid_date: "paid_at", amount: "amount_cents", fx_rate_to_cad: "fx_rate_to_cad_bps",
      amount_cad: "amount_cad_cents", discount_taken: "discount_taken_cents",
    },
  ],
  "card_transactions.csv": ["card_transactions", { txn_id: "ext_id", amount: "amount_cents", amount_cad: "amount_cad_cents" }],
  "bank_statement.csv": ["bank_statement", { bank_txn_id: "ext_id", debit: "debit_cents", credit: "credit_cents" }],
  "fx_rates.csv": ["fx_rates", { usd_to_cad: "usd_to_cad_bps" }],
  "approval_policies.csv": ["approval_policies", { rule_id: "ext_id" }],
};

const dataDir = path.join(process.cwd(), "brim_ap_dataset", "data");
const d = new Database(":memory:");
applySchema(d);
const columns = (t: string) => (d.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name);

test("every dataset CSV is covered by the map", () => {
  expect(fs.readdirSync(dataDir).filter((f) => f.endsWith(".csv")).sort()).toEqual(Object.keys(MAP).sort());
});

test.each(Object.entries(MAP))("%s: every column has a home in the table", (file, [table, renames]) => {
  const header = fs.readFileSync(path.join(dataDir, file), "utf8").split(/\r?\n/)[0].split(",");
  const have = columns(table);
  const missing = header.filter((h) => !have.includes(renames[h] ?? h));
  expect(missing).toEqual([]);
});

test("ids from the dataset are kept in ext_id", () => {
  for (const t of ["users", "departments", "vendors", "contracts", "invoices", "approvals", "payments", "card_transactions", "bank_statement", "approval_policies", "vendor_bank_changes"])
    expect(columns(t)).toContain("ext_id");
});

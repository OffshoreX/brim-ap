// Loads brim_ap_dataset/data/*.csv into the domain tables. Idempotent: every row is an upsert on a stable key.
// Imported by scripts/import-dataset.mjs, which re-runs itself with a resolver for the extensionless relative imports.
import type Database from "better-sqlite3";
import { appendAudit } from "./audit";
import fs from "node:fs";
import path from "node:path";

type Row = Record<string, string>;

// Minimal RFC 4180 reader (quoted fields, "" escapes, CRLF). Avoids a new dependency.
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// "2520.00" -> 252000 with string math only, so no float ever touches money. scale 2 = cents, 4 = FX rate x10000.
export function decimalToInt(s: string, scale = 2): number | null {
  if (s === "") return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[3] ?? "").length > scale) throw new Error(`bad decimal "${s}" for scale ${scale}`);
  return Number(m[1] + m[2] + (m[3] ?? "").padEnd(scale, "0"));
}

const num = (s: string) => (s === "" ? null : Number(s.match(/(\d+)$/)![1])); // "AP-00012" -> 12, "PO-2026-0007" -> 7
const txt = (s: string) => (s === "" ? null : s);
const cents = (s: string) => decimalToInt(s, 2);
const yesNo = (s: string) => (s === "" ? null : s === "yes" ? 1 : 0);

type Spec = {
  file: string;
  table: string;
  key: string; // conflict target: the column that makes a re-run hit the same row
  cols: Record<string, (r: Row) => string | number | null>;
};

// Column order here is also the load order: parents before children.
function specs(ctx: { deptName: Map<string, string> }): Spec[] {
  return [
    { file: "departments.csv", table: "departments", key: "id", cols: {
      id: (r) => num(r.department_id), ext_id: (r) => r.department_id, name: (r) => r.name, cost_centre: (r) => r.cost_centre,
      annual_budget_cents: (r) => cents(r.annual_budget_cad), manager_user_id: (r) => num(r.manager_user_id) } },
    { file: "users.csv", table: "users", key: "id", cols: {
      id: (r) => num(r.user_id), ext_id: (r) => r.user_id, name: (r) => r.full_name, email: (r) => r.email, title: (r) => r.title,
      department_id: (r) => num(r.department_id), role: (r) => r.role, manager_id: (r) => num(r.manager_id),
      approval_limit_cents: (r) => cents(r.approval_limit_cad), province: (r) => r.work_province, status: (r) => r.status,
      status_since: (r) => txt(r.status_since), delegate_user_id: (r) => num(r.delegate_user_id), hire_date: (r) => r.hire_date } },
    { file: "vendors.csv", table: "vendors", key: "id", cols: {
      id: (r) => num(r.vendor_id), ext_id: (r) => r.vendor_id, name: (r) => r.legal_name, category: (r) => r.category,
      default_gl_account: (r) => txt(r.default_gl_account), address: (r) => r.address, province_or_state: (r) => txt(r.province_or_state),
      country: (r) => txt(r.country), gst_hst_number: (r) => txt(r.gst_hst_number), qst_number: (r) => txt(r.qst_number),
      payment_terms_days: (r) => num(r.payment_terms_days), early_pay_discount: (r) => txt(r.early_pay_discount),
      preferred_payment_method: (r) => txt(r.preferred_payment_method), accepts_card_payment: (r) => yesNo(r.accepts_card_payment),
      bank_institution: (r) => txt(r.bank_institution), bank_transit: (r) => txt(r.bank_transit), bank_account: (r) => txt(r.bank_account),
      bank_details_updated_at: (r) => txt(r.bank_details_updated_at), ap_contact_email: (r) => txt(r.ap_contact_email),
      requires_po: (r) => yesNo(r.requires_po), status: (r) => r.status, onboarded_at: (r) => txt(r.onboarded_at) } },
    { file: "bank_change_history.csv", table: "vendor_bank_changes", key: "id", cols: {
      id: (r) => num(r.change_id), ext_id: (r) => r.change_id, vendor_id: (r) => num(r.vendor_id), changed_at: (r) => r.changed_at,
      changed_by_user_id: (r) => num(r.changed_by_user_id), request_channel: (r) => txt(r.request_channel),
      verified_by_callback: (r) => yesNo(r.verified_by_callback), old_account_last4: (r) => txt(r.old_account_last4),
      new_account_last4: (r) => txt(r.new_account_last4) } },
    { file: "contracts.csv", table: "contracts", key: "id", cols: {
      id: (r) => num(r.contract_id), ext_id: (r) => r.contract_id, vendor_id: (r) => num(r.vendor_id), description: (r) => txt(r.description),
      billing_type: (r) => r.billing_type, monthly_fee_cents: (r) => cents(r.monthly_fee), currency: (r) => r.currency,
      hourly_rate_cap_cents: (r) => cents(r.hourly_rate_cap), fuel_surcharge_cap_pct: (r) => (r.fuel_surcharge_cap_pct === "" ? null : Number(r.fuel_surcharge_cap_pct)),
      not_to_exceed_monthly_cents: (r) => cents(r.not_to_exceed_monthly), start_date: (r) => r.start_date, end_date: (r) => r.end_date,
      auto_renew: (r) => yesNo(r.auto_renew) ?? 0, status: (r) => txt(r.status) } },
    { file: "purchase_orders.csv", table: "purchase_orders", key: "id", cols: {
      id: (r) => num(r.po_id), po_number: (r) => r.po_id, vendor_id: (r) => num(r.vendor_id), department_id: (r) => num(r.department_id),
      requester_user_id: (r) => num(r.requester_user_id), issue_date: (r) => txt(r.issue_date), description: (r) => txt(r.description),
      total_cents: (r) => cents(r.total_amount), currency: (r) => r.currency, status: (r) => txt(r.status), approved_by: (r) => num(r.approved_by) } },
    { file: "gl_accounts.csv", table: "gl_accounts", key: "id", cols: { // the account number is already numeric, so it is the id
      id: (r) => num(r.account_number), code: (r) => r.account_number, name: (r) => r.name, account_type: (r) => txt(r.account_type), notes: (r) => txt(r.notes) } },
    { file: "tax_codes.csv", table: "tax_codes", key: "code", cols: {
      code: (r) => r.code, description: (r) => txt(r.description), province: () => null, // rate 0.09975 -> 997.5 bps: integer math (x100000), then /10
      rate_bps: (r) => decimalToInt(r.rate, 5)! / 10, applies_to: (r) => txt(r.applies_to), recoverable: (r) => txt(r.recoverable), gl_account: (r) => txt(r.gl_account) } },
    { file: "invoices.csv", table: "invoices", key: "id", cols: {
      id: (r) => num(r.invoice_id), ext_id: (r) => r.invoice_id, status: (r) => r.status, vendor_id: (r) => num(r.vendor_id),
      invoice_number: (r) => r.vendor_invoice_number, invoice_date: (r) => r.invoice_date, received_date: (r) => txt(r.received_date),
      due_date: (r) => txt(r.due_date), subtotal_cents: (r) => cents(r.subtotal), gst_hst_cents: (r) => cents(r.gst_hst_amount),
      pst_qst_cents: (r) => cents(r.pst_qst_amount), total_cents: (r) => cents(r.total), currency: (r) => r.currency,
      fx_rate_to_cad_bps: (r) => decimalToInt(r.fx_rate_to_cad, 4), total_cad_cents: (r) => cents(r.total_cad),
      requester_id: (r) => num(r.requester_user_id), department: (r) => ctx.deptName.get(r.department_id) ?? null,
      department_id: (r) => num(r.department_id), po_id: (r) => num(r.po_id), contract_id: (r) => num(r.contract_id),
      ship_to_province: (r) => txt(r.ship_to_province) } },
    { file: "invoice_lines.csv", table: "invoice_lines", key: "invoice_id, line_no", cols: {
      invoice_id: (r) => num(r.invoice_id), line_no: (r) => num(r.line_no), line_type: (r) => txt(r.line_type), description: (r) => r.description,
      quantity: (r) => num(r.quantity), unit_price_cents: (r) => cents(r.unit_price), amount_cents: (r) => cents(r.amount), currency: () => null, // filled from the invoice below
      gl_account_id: (r) => num(r.gl_account), department_id: (r) => num(r.department_id), gst_hst_code: (r) => txt(r.gst_hst_code),
      pst_qst_code: (r) => txt(r.pst_qst_code) } },
    { file: "approvals.csv", table: "approvals", key: "id", cols: {
      id: (r) => num(r.approval_id), ext_id: (r) => r.approval_id, invoice_id: (r) => num(r.invoice_id), step_no: (r) => num(r.step_no),
      approver_id: (r) => num(r.approver_user_id), approver_role: (r) => txt(r.approver_role), decision: (r) => r.action,
      decided_at: (r) => r.acted_at, comment: (r) => txt(r.comment) } },
    { file: "payments.csv", table: "payments", key: "id", cols: {
      id: (r) => num(r.payment_id), ext_id: (r) => r.payment_id, invoice_id: (r) => num(r.invoice_id), vendor_id: (r) => num(r.vendor_id),
      method: (r) => r.method, scheduled_date: (r) => txt(r.scheduled_date), paid_at: (r) => txt(r.paid_date), // blank = not paid yet, stays NULL
      amount_cents: (r) => cents(r.amount), currency: (r) => r.currency, fx_rate_to_cad_bps: (r) => decimalToInt(r.fx_rate_to_cad, 4),
      amount_cad_cents: (r) => cents(r.amount_cad), discount_taken_cents: (r) => cents(r.discount_taken) ?? 0, reference: (r) => txt(r.reference),
      status: (r) => r.status, prepared_by: (r) => num(r.prepared_by), released_by: (r) => num(r.released_by) } },
    { file: "card_transactions.csv", table: "card_transactions", key: "id", cols: {
      id: (r) => num(r.txn_id), ext_id: (r) => r.txn_id, card_id: (r) => txt(r.card_id), cardholder_user_id: (r) => num(r.cardholder_user_id),
      posted_date: (r) => r.posted_date, merchant_descriptor: (r) => txt(r.merchant_descriptor), mcc: (r) => txt(r.mcc),
      amount_cents: (r) => cents(r.amount), currency: (r) => r.currency, amount_cad_cents: (r) => cents(r.amount_cad), source: (r) => txt(r.source),
      receipt_attached: (r) => yesNo(r.receipt_attached), memo: (r) => txt(r.memo) } },
    { file: "bank_statement.csv", table: "bank_statement", key: "id", cols: {
      id: (r) => num(r.bank_txn_id), ext_id: (r) => r.bank_txn_id, posted_date: (r) => r.posted_date, description: (r) => txt(r.description),
      debit_cents: (r) => cents(r.debit), credit_cents: (r) => cents(r.credit) } },
    { file: "fx_rates.csv", table: "fx_rates", key: "date", cols: { date: (r) => r.date, usd_to_cad_bps: (r) => decimalToInt(r.usd_to_cad, 4) } },
    { file: "approval_policies.csv", table: "approval_policies", key: "id", cols: {
      id: (r) => num(r.rule_id), ext_id: (r) => r.rule_id, rule_type: (r) => r.rule_type, condition: (r) => r.condition, required: (r) => txt(r.required), notes: (r) => txt(r.notes) } },
  ];
}

export type ImportSummary = Record<string, number>;

export function importDataset(db: Database.Database, dir = path.join(process.cwd(), "brim_ap_dataset", "data")): ImportSummary {
  const read = (f: string) => parseCsv(fs.readFileSync(path.join(dir, f), "utf8"));
  const deptName = new Map(read("departments.csv").map((r) => [r.department_id, r.name]));
  const invoiceCurrency = new Map(read("invoices.csv").map((r) => [r.invoice_id, r.currency]));

  db.transaction(() => {
    // users <-> departments point at each other; check foreign keys once at commit instead of per row.
    db.pragma("defer_foreign_keys = ON");
    for (const s of specs({ deptName })) {
      const names = Object.keys(s.cols);
      const keyCols = s.key.split(", ");
      const update = names.filter((n) => !keyCols.includes(n)).map((n) => `${n}=excluded.${n}`).join(", ");
      const stmt = db.prepare(
        `INSERT INTO ${s.table} (${names.join(",")}) VALUES (${names.map((n) => "@" + n).join(",")}) ON CONFLICT(${s.key}) DO UPDATE SET ${update}`
      );
      for (const r of read(s.file)) {
        const values = Object.fromEntries(names.map((n) => [n, s.cols[n](r)]));
        if (s.table === "invoice_lines") values.currency = invoiceCurrency.get(r.invoice_id)!; // a line is in its invoice's currency
        stmt.run(values);
      }
    }
    const summary = counts(db);
    // Bulk load is a state change too: one append-only audit row per run with the resulting counts.
    appendAudit(db, { actorId: null, action: "import_dataset", entity: "dataset", after: summary });
  })();
  return counts(db);
}

const TABLES = ["departments", "users", "vendors", "vendor_bank_changes", "contracts", "purchase_orders", "gl_accounts", "tax_codes", "invoices",
  "invoice_lines", "approvals", "payments", "card_transactions", "bank_statement", "fx_rates", "approval_policies"];

export function counts(db: Database.Database): ImportSummary {
  return Object.fromEntries(TABLES.map((t) => [t, (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n]));
}

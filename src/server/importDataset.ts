// Loads brim_ap_dataset/data/*.csv into the domain tables. Idempotent: every row is an upsert on a stable key.
// Imported by scripts/import-dataset.mjs, which re-runs itself with a resolver for the extensionless relative imports.
import type Database from "better-sqlite3";
import { appendAudit } from "./audit";
import fs from "node:fs";
import path from "node:path";

type Row = Record<string, string>;

// Minimal RFC 4180 reader (quoted fields, "" escapes, CRLF). Avoids a new dependency.
export function parseCsv(text: string): Row[] {
  return csvTable(text).rows;
}

// Same reader, but keeps the header so a file with no data rows can still be checked for its columns.
export function csvTable(text: string): { header: string[]; rows: Row[] } {
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
  return { header: header ?? [], rows: body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))) };
}

// "2520.00" -> 252000 with string math only, so no float ever touches money. scale 2 = cents, 4 = FX rate x10000.
export function decimalToInt(s: string, scale = 2): number | null {
  if (s === "") return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[3] ?? "").length > scale) throw new Error(`bad decimal "${s}" for scale ${scale}`);
  return Number(m[1] + m[2] + (m[3] ?? "").padEnd(scale, "0"));
}

const num = (s: string) => { // "AP-00012" -> 12, "PO-2026-0007" -> 7
  if (s === "") return null;
  const m = /(\d+)$/.exec(s);
  if (!m) throw new Error(`"${s}" does not end in a number`);
  return Number(m[1]);
};
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
      ship_to_province: (r) => txt(r.ship_to_province), ship_to_source: (r) => (txt(r.ship_to_province) ? "invoice" : null) } },
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

// Everything wrong with a folder, as plain sentences. Thrown before the first write so a bad folder changes nothing.
export class DatasetError extends Error {
  constructor(public problems: string[]) { super(problems.join("\n")); }
}

// The CSV columns each file must have = the columns the importer reads. A probe row that answers "" to every
// question records them, so this list can never drift from the loader (and the demo-data generator reuses it).
export function requiredColumns(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of specs({ deptName: new Map() })) {
    const seen = new Set<string>();
    const probe = new Proxy({}, { get: (_, k) => (seen.add(String(k)), "") }) as Row;
    for (const f of Object.values(s.cols)) f(probe);
    out[s.file] = [...seen];
  }
  return out;
}

// The column(s) that identify a row; two rows with the same value would silently overwrite each other.
const KEYS: Record<string, string[]> = {
  "departments.csv": ["department_id"], "users.csv": ["user_id"], "vendors.csv": ["vendor_id"], "bank_change_history.csv": ["change_id"],
  "contracts.csv": ["contract_id"], "purchase_orders.csv": ["po_id"], "gl_accounts.csv": ["account_number"], "tax_codes.csv": ["code"],
  "invoices.csv": ["invoice_id"], "invoice_lines.csv": ["invoice_id", "line_no"], "approvals.csv": ["approval_id"], "payments.csv": ["payment_id"],
  "card_transactions.csv": ["txn_id"], "bank_statement.csv": ["bank_txn_id"], "fx_rates.csv": ["date"], "approval_policies.csv": ["rule_id"],
};
// [file, column, file that must contain that id]: a dangling reference is reported with its row, not as a bare database error.
const REFS: [string, string, string][] = [
  ["users.csv", "department_id", "departments.csv"], ["invoices.csv", "vendor_id", "vendors.csv"], ["invoice_lines.csv", "invoice_id", "invoices.csv"],
  ["approvals.csv", "invoice_id", "invoices.csv"], ["payments.csv", "invoice_id", "invoices.csv"],
];
const isDateColumn = (c: string) => /(_date|_at)$|^date$/.test(c);
function isRealDate(v: string) { // 2026-02-30 matches the pattern but is not a day, so round-trip it
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2})?)?$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Checks the data/ folder: files, columns, unique ids, references, dates, money. Row 1 is the header, like in a spreadsheet.
export function validateDataset(dir: string): string[] {
  const problems: string[] = [];
  const required = requiredColumns();
  const ids = new Map<string, Set<string>>(); // file -> first key column values, for the reference check
  const loaded: { file: string; rows: Row[]; header: string[] }[] = [];
  for (const s of specs({ deptName: new Map() })) {
    const p = path.join(dir, s.file);
    if (!fs.existsSync(p)) { problems.push(`${s.file} is missing from the data folder.`); continue; }
    const { header, rows } = csvTable(fs.readFileSync(p, "utf8"));
    const missing = required[s.file].filter((c) => !header.includes(c));
    if (missing.length) { problems.push(`${s.file} has no column named ${missing.map((c) => `"${c}"`).join(", ")}.`); continue; }
    loaded.push({ file: s.file, rows, header });
    const seen = new Map<string, number>();
    const keyCol = KEYS[s.file];
    rows.forEach((r, i) => {
      const row = i + 2;
      const key = keyCol.map((c) => r[c]).join("/");
      if (keyCol.some((c) => r[c] === "")) problems.push(`${s.file} row ${row}: ${keyCol.join(" + ")} is empty.`);
      else if (seen.has(key)) problems.push(`${s.file} row ${row}: ${keyCol.join(" + ")} "${key}" was already used on row ${seen.get(key)}.`);
      else seen.set(key, row);
      for (const c of header) if (isDateColumn(c) && r[c] !== "" && !isRealDate(r[c])) problems.push(`${s.file} row ${row}: ${c} "${r[c]}" is not a valid date (use YYYY-MM-DD).`);
      for (const [col, f] of Object.entries(s.cols)) {
        try { f(r); } catch (e) { problems.push(`${s.file} row ${row}: could not read ${col} (${(e as Error).message}).`); }
      }
    });
    ids.set(s.file, new Set(rows.map((r) => r[keyCol[0]])));
  }
  for (const [file, col, parent] of REFS) {
    const known = ids.get(parent);
    const l = loaded.find((x) => x.file === file);
    if (!known || !l) continue; // the missing file was already reported
    l.rows.forEach((r, i) => { if (r[col] !== "" && !known.has(r[col])) problems.push(`${file} row ${i + 2}: ${col} "${r[col]}" is not in ${parent}.`); });
  }
  return problems;
}

// Checks the whole folder: data/ plus the optional inbox/emails.json and the invoice files its emails point at.
export function validateFolder(root: string): string[] {
  const problems = validateDataset(path.join(root, "data"));
  const emailsFile = path.join(root, "inbox", "emails.json");
  if (!fs.existsSync(emailsFile)) return problems;
  let emails: unknown;
  try { emails = JSON.parse(fs.readFileSync(emailsFile, "utf8")); } catch { return [...problems, "inbox/emails.json is not valid JSON."]; }
  if (!Array.isArray(emails)) return [...problems, "inbox/emails.json must be a list of emails."];
  const seen = new Set<string>();
  emails.forEach((e, i) => {
    const where = `inbox/emails.json email ${i + 1}`;
    if (typeof e?.email_id !== "string" || !Array.isArray(e.attachments) || typeof e.from_address !== "string" || typeof e.subject !== "string" || typeof e.body !== "string")
      return problems.push(`${where}: needs email_id, from_address, subject, body and an attachments list.`);
    if (seen.has(e.email_id)) problems.push(`${where}: email_id "${e.email_id}" is used twice.`);
    seen.add(e.email_id);
    for (const a of e.attachments as string[])
      if (!fs.existsSync(path.join(root, "incoming_invoices", path.basename(a)))) problems.push(`${where}: attachment "${a}" is not in incoming_invoices/.`);
  });
  return problems;
}

export function importDataset(db: Database.Database, dir = path.join(process.cwd(), "brim_ap_dataset", "data")): ImportSummary {
  const problems = validateDataset(dir);
  if (problems.length) throw new DatasetError(problems);
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
      read(s.file).forEach((r, i) => {
        const values = Object.fromEntries(names.map((n) => [n, s.cols[n](r)]));
        if (s.table === "invoice_lines") values.currency = invoiceCurrency.get(r.invoice_id)!; // a line is in its invoice's currency
        // A value the database refuses (e.g. an unknown role) aborts the whole transaction, so nothing is half-loaded.
        try { stmt.run(values); } catch (e) { throw new DatasetError([`${s.file} row ${i + 2}: the database refused it (${(e as Error).message}).`]); }
      });
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

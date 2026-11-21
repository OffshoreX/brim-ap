// Loads a dataset folder into the database. With no flags it loads the committed sample in brim_ap_dataset/.
//
// Folder layout (same as brim_ap_dataset/):
//   <dir>/data/*.csv            16 files, one per table, header row first. Files and columns are listed below.
//   <dir>/inbox/emails.json     optional: a list of {email_id, from_address, subject, body, attachments[]}
//   <dir>/incoming_invoices/    optional: the files named in each email's attachments
// Columns each CSV must have (extra columns are ignored):
//   departments.csv: department_id, name, cost_centre, annual_budget_cad, manager_user_id
//   users.csv: user_id, full_name, email, title, department_id, role, manager_id, approval_limit_cad, work_province, status, status_since, delegate_user_id, hire_date
//   vendors.csv: vendor_id, legal_name, category, default_gl_account, address, province_or_state, country, gst_hst_number, qst_number, payment_terms_days, early_pay_discount, preferred_payment_method, accepts_card_payment, bank_institution, bank_transit, bank_account, bank_details_updated_at, ap_contact_email, requires_po, status, onboarded_at
//   bank_change_history.csv: change_id, vendor_id, changed_at, changed_by_user_id, request_channel, verified_by_callback, old_account_last4, new_account_last4
//   contracts.csv: contract_id, vendor_id, description, billing_type, monthly_fee, currency, hourly_rate_cap, fuel_surcharge_cap_pct, not_to_exceed_monthly, start_date, end_date, auto_renew, status
//   purchase_orders.csv: po_id, vendor_id, department_id, requester_user_id, issue_date, description, total_amount, currency, status, approved_by
//   gl_accounts.csv: account_number, name, account_type, notes
//   tax_codes.csv: code, description, rate, applies_to, recoverable, gl_account
//   invoices.csv: invoice_id, status, vendor_id, vendor_invoice_number, invoice_date, received_date, due_date, subtotal, gst_hst_amount, pst_qst_amount, total, currency, fx_rate_to_cad, total_cad, requester_user_id, department_id, po_id, contract_id, ship_to_province
//   invoice_lines.csv: invoice_id, line_no, line_type, description, quantity, unit_price, amount, gl_account, department_id, gst_hst_code, pst_qst_code
//   approvals.csv: approval_id, invoice_id, step_no, approver_user_id, approver_role, action, acted_at, comment
//   payments.csv: payment_id, invoice_id, vendor_id, method, scheduled_date, paid_date, amount, currency, fx_rate_to_cad, amount_cad, discount_taken, reference, status, prepared_by, released_by
//   card_transactions.csv: txn_id, card_id, cardholder_user_id, posted_date, merchant_descriptor, mcc, amount, currency, amount_cad, source, receipt_attached, memo
//   bank_statement.csv: bank_txn_id, posted_date, description, debit, credit
//   fx_rates.csv: date, usd_to_cad
//   approval_policies.csv: rule_id, rule_type, condition, required, notes
// Money is a plain decimal ("2520.00", at most 2 decimals; FX rates at most 4). Dates are YYYY-MM-DD (or with THH:MM[:SS]).
// Ids must be unique per file. A problem is printed as a sentence with the file and row (row 1 is the header), and
// nothing is written. Success prints the row count per table.
//
// Flags: --dir <folder>  load this folder instead of brim_ap_dataset/   --reset  delete the database and rebuild it first
// The database is DB_PATH (default data/app.db). To let the app read the folder's emails, start it with INBOX_DIR=<folder>.
//
// Example (two commands):
//   node scripts/make-demo-data.mjs --out /tmp/demo-data
//   node scripts/import-dataset.mjs --dir /tmp/demo-data --reset
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { register } from "node:module";

if (process.argv.includes("--help")) { // print the comment block at the top of this file
  const text = fs.readFileSync(new URL(import.meta.url), "utf8");
  const lines = text.split("\n");
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n").replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

// The server code is TypeScript with extensionless imports. Plain Node needs one flag and a 1-line resolver to run it as is.
if (!process.execArgv.includes("--experimental-transform-types")) {
  const r = spawnSync(process.execPath, ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && s.startsWith(".")) return next(s + ".ts", c); throw e; } }`
));

const { applySchema } = await import("../src/server/db.ts");
const { importDataset, validateFolder, DatasetError } = await import("../src/server/importDataset.ts");
const { setDemoPasswords } = await import("../src/server/password.ts");

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const root = path.resolve(flag("--dir") ?? "brim_ap_dataset");

// Validate first: a bad folder must not even touch the database (and --reset must not delete a good database for it).
const problems = validateFolder(root);
if (problems.length) {
  console.error(`Nothing was imported. ${problems.length} problem(s) in ${root}:`);
  for (const p of problems.slice(0, 50)) console.error(`  - ${p}`);
  if (problems.length > 50) console.error(`  ... and ${problems.length - 50} more.`);
  process.exit(1);
}

const file = process.env.DB_PATH || "data/app.db";
if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
if (args.includes("--reset") && file !== ":memory:") for (const f of [file, file + "-wal", file + "-shm"]) fs.rmSync(f, { force: true });
const db = new Database(file);
applySchema(db);
let summary;
try {
  summary = importDataset(db, path.join(root, "data"));
} catch (e) {
  if (!(e instanceof DatasetError)) throw e;
  console.error(`Nothing was imported (the database rolled everything back):\n  - ${e.problems.join("\n  - ")}`);
  process.exit(1);
}
setDemoPasswords(db); // every sample user gets the demo password (never printed)
const countFiles = (d) => (fs.existsSync(d) ? fs.readdirSync(d).length : 0);
console.log(`Imported ${root} into ${file}`);
console.table(summary);
console.log(`emails in inbox/emails.json: ${fs.existsSync(path.join(root, "inbox", "emails.json")) ? JSON.parse(fs.readFileSync(path.join(root, "inbox", "emails.json"), "utf8")).length : 0}; files in incoming_invoices/: ${countFiles(path.join(root, "incoming_invoices"))}`);

// Writes a synthetic dataset folder in the same shape as brim_ap_dataset/: node scripts/make-demo-data.mjs --out <folder>
// Fixed seed, so the same command always writes the same folder. All names are invented (.example addresses).
// 8 vendors, 3 users per role, 30 invoices (all "received") with three planted problems the rules should catch:
//   invoice 30 repeats invoice 5 (duplicate), invoice 17 has the wrong tax rate, invoice 24 comes from a vendor
//   whose bank account changed two days earlier without a callback.
// Headers come from the importer's own column list and the result is checked by the importer's own validator,
// so the folder always loads. Load it with: node scripts/import-dataset.mjs --dir <folder> --reset
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { register } from "node:module";

// Same re-run-with-a-resolver trick as scripts/import-dataset.mjs, so this file can import the TypeScript importer.
if (!process.execArgv.includes("--experimental-transform-types")) {
  const r = spawnSync(process.execPath, ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && s.startsWith(".")) return next(s + ".ts", c); throw e; } }`
));
const { requiredColumns, validateFolder } = await import("../src/server/importDataset.ts");

const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined;
if (!out) { console.error("Usage: node scripts/make-demo-data.mjs --out <folder>"); process.exit(1); }

let seed = 141; // mulberry32: a tiny seeded random generator, enough to make the amounts look uneven but repeatable
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const cents = (c) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`; // integer cents -> "12.30", no float money
const day = (n) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10); // day 0 = 2026-10-01
const pad = (n, w = 3) => String(n).padStart(w, "0");

const roles = ["controller_admin", "finance_manager", "approver", "ap_clerk", "employee", "auditor"];
const limit = { controller_admin: 500000, finance_manager: 250000, approver: 10000 };
const first = ["Avery", "Blake", "Casey"], last = ["North", "Reed", "Stone", "Vale", "Wynn", "Yates"];
const users = roles.flatMap((role, r) => [0, 1, 2].map((k) => {
  const n = r * 3 + k + 1;
  return { user_id: `U${pad(n)}`, full_name: `${first[k]} ${last[r]}`, email: `${first[k]}.${last[r]}@demo-co.example`.toLowerCase(), title: role.replace("_", " "),
    department_id: `D0${(n % 4) + 1}`, manager_id: r === 0 ? "" : "U001", role, approval_limit_cad: limit[role] ?? 0, work_province: n % 2 ? "ON" : "QC",
    status: "active", status_since: "", delegate_user_id: "", hire_date: "2024-01-15" };
}));
const departments = [0, 1, 2, 3].map((i) => ({ department_id: `D0${i + 1}`, name: ["Operations", "Sales", "IT", "Finance"][i], cost_centre: 1100 + i * 100,
  annual_budget_cad: 500000, manager_user_id: `U00${7 + (i % 3)}` }));

const names = ["Alder Freight Co.", "Birchwood Logistics Ltd.", "Cobalt Fuel Services", "Driftwood Office Supply", "Ember IT Consulting", "Fernhill Facility Care", "Granite Pallet Works", "Harbourlight Couriers"];
const gls = [5010, 5010, 5020, 6210, 6110, 6610, 5030, 5010];
const provinces = ["ON", "QC", "AB"];
const vendors = names.map((legal_name, i) => {
  const province_or_state = provinces[i % 3];
  const slug = legal_name.split(" ")[0].toLowerCase();
  return { vendor_id: `V${pad(i + 1)}`, legal_name, category: "Demo services", default_gl_account: gls[i], address: `${100 + i} Demo Street, ${province_or_state}`, province_or_state, country: "CA",
    gst_hst_number: `${900000000 + i}RT0001`, qst_number: province_or_state === "QC" ? `${1000000000 + i}TQ0001` : "", payment_terms_days: 30, early_pay_discount: "",
    preferred_payment_method: "EFT", accepts_card_payment: "no", bank_institution: "004", bank_transit: String(10000 + i * 7), bank_account: String(200000000 + i * 1311),
    bank_details_updated_at: i === 0 ? day(22) : "", ap_contact_email: `ar@${slug}.example`, requires_po: "no", status: "active", onboarded_at: "2024-03-01" };
});
const bank_change_history = [{ change_id: "BC-001", vendor_id: "V001", changed_at: day(22), changed_by_user_id: "U010", request_channel: "email_request",
  verified_by_callback: "no", old_account_last4: "2000", new_account_last4: "0000" }];

// Rates as integer math: tax = round(subtotal * num / den).
const taxOf = (sub, num, den) => Math.round((sub * num) / den);
const invoices = [], invoice_lines = [], subtotals = {}; // subtotals keeps cents as integers for the duplicate copy
const make = (i, v, subtotal, number, wrongTax = false) => {
  subtotals[i] = subtotal;
  const prov = v.province_or_state;
  const gstCode = prov === "ON" ? "HST13" : "GST5";
  const gstRate = prov === "ON" ? [13, 100] : [5, 100];
  const wrong = wrongTax ? (prov === "ON" ? [5, 100] : [13, 100]) : gstRate; // planted: the other province's rate
  const gst = taxOf(subtotal, ...wrong);
  const qst = prov === "QC" ? taxOf(subtotal, 9975, 100000) : 0;
  const total = subtotal + gst + qst;
  invoices.push({ invoice_id: `AP-${pad(i, 5)}`, status: "received", vendor_id: v.vendor_id, vendor_invoice_number: number, invoice_date: day(i), received_date: day(i), due_date: day(i + 30),
    subtotal: cents(subtotal), gst_hst_amount: cents(gst), pst_qst_amount: cents(qst), total: cents(total), currency: "CAD", fx_rate_to_cad: "1", total_cad: cents(total),
    requester_user_id: `U0${13 + (i % 3)}`, department_id: `D0${(i % 4) + 1}`, po_id: "", contract_id: "", ship_to_province: prov });
  invoice_lines.push({ invoice_id: `AP-${pad(i, 5)}`, line_no: 1, line_type: "services", description: `Services from ${v.legal_name}`, quantity: 1, unit_price: cents(subtotal),
    amount: cents(subtotal), gl_account: v.default_gl_account, department_id: `D0${(i % 4) + 1}`, gst_hst_code: gstCode, pst_qst_code: qst ? "QST9975" : "" });
};
for (let i = 1; i <= 29; i++) {
  const v = vendors[i % 8];
  make(i, v, 50000 + Math.floor(rand() * 850000), `${v.legal_name.slice(0, 2).toUpperCase()}26-${1000 + i * 7}`, i === 17);
}
const src = invoices[4]; // invoice 5, copied as invoice 30 with the same vendor, number and amounts
make(30, vendors.find((v) => v.vendor_id === src.vendor_id), subtotals[5], src.vendor_invoice_number);

const tables = {
  "departments.csv": departments, "users.csv": users, "vendors.csv": vendors, "bank_change_history.csv": bank_change_history, "contracts.csv": [], "purchase_orders.csv": [],
  "gl_accounts.csv": [[1160, "GST/HST Receivable", "asset"], [5010, "Freight", "expense"], [5020, "Fuel", "expense"], [5030, "Packaging", "expense"], [6110, "IT Services", "expense"],
    [6210, "Office Supplies", "expense"], [6610, "Facilities", "expense"]].map(([account_number, name, account_type]) => ({ account_number, name, account_type, notes: "" })),
  "tax_codes.csv": [["HST13", "Ontario HST 13%", "0.13"], ["GST5", "GST 5%", "0.05"], ["QST9975", "Quebec QST 9.975%", "0.09975"]]
    .map(([code, description, rate]) => ({ code, description, rate, applies_to: "all", recoverable: "yes", gl_account: 1160 })),
  "invoices.csv": invoices, "invoice_lines.csv": invoice_lines, "approvals.csv": [], "payments.csv": [], "card_transactions.csv": [], "bank_statement.csv": [],
  "fx_rates.csv": [0, 1, 2, 3, 4].map((n) => ({ date: day(n), usd_to_cad: "1.3700" })),
  "approval_policies.csv": [["P01", "Invoice total up to $10,000 CAD", "dept_manager"], ["P02", "Invoice total over $10,000 CAD", "dept_manager > finance_manager"]]
    .map(([rule_id, condition, required]) => ({ rule_id, rule_type: "approval", condition, required, notes: "" })),
};

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
const columns = requiredColumns();
fs.mkdirSync(path.join(out, "data"), { recursive: true });
fs.mkdirSync(path.join(out, "inbox"), { recursive: true });
fs.mkdirSync(path.join(out, "incoming_invoices"), { recursive: true });
for (const [file, rows] of Object.entries(tables)) {
  const cols = columns[file];
  fs.writeFileSync(path.join(out, "data", file), [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c] ?? "")).join(","))].join("\n") + "\n");
}
fs.writeFileSync(path.join(out, "inbox", "emails.json"), "[]\n"); // no PDFs are generated; the folder is for the CSV import

const problems = validateFolder(out); // the same validator the importer runs, so a generator bug fails here, not at demo time
if (problems.length) { console.error(`Generator bug, the folder would not load:\n  - ${problems.join("\n  - ")}`); process.exit(1); }
console.log(`Wrote ${out}: ${vendors.length} vendors, ${users.length} users, ${invoices.length} invoices (duplicate: AP-00030, wrong tax: AP-00017, bank change: AP-00024 from V001).`);

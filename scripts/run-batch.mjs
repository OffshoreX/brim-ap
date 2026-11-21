// Runs every file in brim_ap_dataset/incoming_invoices through the real pipeline and prints what happened:
//   node scripts/run-batch.mjs          (offline: only files already in data/extract-cache are read, the model is never called)
//   node scripts/run-batch.mjs --live   (also loads .env.local, so an uncached file is sent to the model)
// Uses its own database (data/batch.db) so the demo database is never wiped. Writes data/batch-report.json.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

// The server code is TypeScript with extensionless imports. Plain Node needs one flag and a 1-line resolver to run it as is.
if (!process.execArgv.includes("--experimental-transform-types")) {
  const r = spawnSync(process.execPath, ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && s.startsWith(".")) return next(s + ".ts", c); throw e; } }`
));

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const live = process.argv.includes("--live");
if (live) {
  try { process.loadEnvFile(".env.local"); } catch { /* no .env.local */ }
} else {
  delete process.env.ANTHROPIC_API_KEY; // offline run: an uncached file becomes needs_review instead of a paid call
}
process.env.DB_PATH = "data/batch.db";
process.env.UPLOAD_DIR = "data/batch-uploads";
fs.rmSync("data/batch.db", { force: true });
fs.rmSync("data/batch-uploads", { recursive: true, force: true });

const { getDb } = await import("../src/server/db.ts");
const { importDataset } = await import("../src/server/importDataset.ts");
const { uploadInvoices } = await import("../src/server/invoices.ts");
const { processInvoice } = await import("../src/server/pipeline.ts");

const db = getDb();
importDataset(db);
// Same two calls the routes make: upload stores the file as 'received', process extracts and checks it.
const CLERK = db.prepare("SELECT id, role FROM users WHERE role = 'ap_clerk' ORDER BY id LIMIT 1").get();

const dir = path.join("brim_ap_dataset", "incoming_invoices");
const files = fs.readdirSync(dir).filter((f) => /\.(pdf|png|jpe?g)$/i.test(f)).sort();
const rows = [];
// One at a time: duplicate, split and PO checks look at invoices already stored, so order matters.
for (const file of files) {
  try {
    const [{ invoiceId }] = uploadInvoices(CLERK, [fs.readFileSync(path.join(dir, file))]);
    const res = await processInvoice(invoiceId, CLERK.id);
    const inv = db.prepare("SELECT v.name AS vendor FROM invoices i LEFT JOIN vendors v ON v.id = i.vendor_id WHERE i.id = ?").get(invoiceId);
    rows.push({ file, vendorMatched: inv.vendor ? "y" : "n", vendor: inv.vendor ?? "", status: res.status, flags: res.flags.map((f) => f.code) });
  } catch (e) {
    rows.push({ file, vendorMatched: "n", vendor: "", status: "CRASHED", flags: [e instanceof Error ? e.message : String(e)] });
  }
}

const summary = {};
for (const r of rows) for (const code of new Set(r.flags)) summary[code] = (summary[code] ?? 0) + 1;

// A code that fires several times on one file (one per matching history row) shows once with "xN"; the JSON keeps every flag.
const compact = (flags) => [...new Set(flags)].map((c) => { const n = flags.filter((f) => f === c).length; return n > 1 ? `${c} x${n}` : c; }).join(", ");
console.table(rows.map((r) => ({ file: r.file, vendor: r.vendorMatched, status: r.status, flags: compact(r.flags) })));
console.table(Object.entries(summary).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, files]) => ({ code, files })));
const crashed = rows.filter((r) => r.status === "CRASHED").length;
const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`${rows.length} files: ${count("pending_approval")} pending_approval, ${count("needs_review")} needs_review, ${crashed} crashed; ${rows.filter((r) => r.vendorMatched === "y").length} vendors matched`);

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/batch-report.json", JSON.stringify({ rows, summary }, null, 2));
process.exit(crashed ? 1 : 0);

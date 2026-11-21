// Reconciles the dataset's payments against bank_statement.csv and card_transactions.csv and prints the counts:
//   node scripts/reconcile.mjs
// Uses a throwaway database in the system temp folder, so the demo database is never touched.
import fs from "node:fs";
import os from "node:os";
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

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-"));
process.env.DB_PATH = path.join(dir, "reconcile.db");

const { getDb } = await import("../src/server/db.ts");
const { importDataset } = await import("../src/server/importDataset.ts");
const { applyReconciliation, buildReport, CATEGORIES } = await import("../src/server/reconciliation.ts");

importDataset(getDb());
const { changed } = applyReconciliation(null); // actor null = the script, recorded in the audit log like any other writer
const { report } = buildReport();
console.log(`${changed} payment statuses saved (audited). Counts by category:`);
console.table(report.summary);
const money = (c) => (c === null ? "" : (c / 100).toFixed(2));
for (const cat of CATEGORIES) {
  console.log(`\n${cat}: ${report.summary[cat]}`);
  for (const r of report.rows.filter((x) => x.category === cat).slice(0, 3))
    console.log(`  payment ${r.paymentId ?? "-"} ${r.invoiceNumber ?? ""} ${r.vendor ?? ""} ${r.method ?? ""} ${money(r.paymentCents)} | ${r.lineSource ?? "-"} ${r.lineId ?? "-"} ${r.lineDate ?? ""} "${r.lineText ?? ""}" ${money(r.lineCents)} | diff ${money(r.diffCents)} | ${r.note}`);
}
fs.rmSync(dir, { recursive: true, force: true });

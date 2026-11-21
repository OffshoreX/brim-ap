// Replays the dataset's historical approvals and payment releases against our routing and release rules:
//   node scripts/replay-history.mjs
// Uses its own database (data/replay.db, ignored by git) so the demo database is never wiped.
// Prints the cause table and writes the same to data/replay-report.json (override with REPLAY_REPORT=path).
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

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
process.env.DB_PATH = process.env.REPLAY_DB || "data/replay.db";
fs.rmSync(process.env.DB_PATH, { force: true }); // reset: always start from an empty database

const { getDb } = await import("../src/server/db.ts");
const { importDataset } = await import("../src/server/importDataset.ts");
const { replayHistory } = await import("../src/server/replayHistory.ts");

importDataset(getDb());
const report = replayHistory();

console.log(`Replayed ${report.invoices} invoices, ${report.approvals} approval steps, ${report.payments} payments (dataset as-of ${report.asOf})`);
console.table(report.causes.map((c) => ({ cause: c.label, count: c.count, verdict: c.verdict, examples: c.examples.join(", ") })));
if (!report.causes.length) console.log("No disagreements.");

const out = process.env.REPLAY_REPORT || "data/replay-report.json";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`Report written to ${out}`);

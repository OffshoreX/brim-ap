// Finds the real-world mess the dataset README promises, using our own rules:
//   node scripts/mess-report.mjs
// 1. fresh database, dataset imported; 2. every historical invoice is run through the rule functions as if it had just arrived;
// 3. the 56 incoming files go through the real pipeline (offline: the extractor answers only from its cache, the model is never called).
// Prints a table of findings by type and writes the same to data/mess-report.json (override with MESS_REPORT=path).
// EXTRACT_CACHE_DIR points at a cache folder other than data/extract-cache. Uses its own database, so the demo database is never wiped.
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
delete process.env.ANTHROPIC_API_KEY; // offline by construction: an uncached file becomes needs_review, never a paid call
process.env.DB_PATH = process.env.MESS_DB || "data/mess.db";
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "mess-uploads-")); // uploaded copies are scratch, removed at the end
process.env.UPLOAD_DIR = uploads;
fs.mkdirSync(path.dirname(process.env.DB_PATH), { recursive: true });
fs.rmSync(process.env.DB_PATH, { force: true }); // reset: always start from an empty database

const { getDb } = await import("../src/server/db.ts");
const { importDataset } = await import("../src/server/importDataset.ts");
const { AS_OF } = await import("../src/server/replayHistory.ts");
const { buildReport, historyHits, incomingHits } = await import("../src/server/messReport.ts");

importDataset(getDb());
const history = historyHits(); // before any incoming file is stored, so the incoming ones are not mixed into the history
const incoming = await incomingHits(path.join("brim_ap_dataset", "incoming_invoices"));
fs.rmSync(uploads, { recursive: true, force: true });

const report = buildReport(history.hits, incoming.hits, { asOf: AS_OF, historicalInvoices: history.invoices, incomingFiles: incoming.files, incomingNotExtracted: incoming.notExtracted, incomingWithoutShipTo: incoming.noShipTo });
console.log(`${report.historicalInvoices} historical invoices, ${report.incomingFiles} incoming files (${incoming.notExtracted.length} had no cached extraction, ${incoming.noShipTo} extractions carry no ship-to province so their place of supply was guessed)`);
console.table(report.rows.map((r) => ({ type: r.label, history: r.history, incoming: r.incoming, examples: r.examples.join(", "), codes: Object.entries(r.codes).map(([c, n]) => `${c} x${n}`).join(", ") })));
const other = Object.entries(report.other).sort((a, b) => b[1] - a[1]);
if (other.length) console.log("Other findings:", other.map(([c, n]) => `${c} x${n}`).join(", "));
const zero = report.rows.filter((r) => r.history + r.incoming === 0).map((r) => r.label);
if (zero.length) console.log("No hits:", zero.join("; "));

const out = process.env.MESS_REPORT || "data/mess-report.json";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`Report written to ${out}`);

// Reads every file in brim_ap_dataset/incoming_invoices with the real extractor and prints one table:
//   node scripts/extract-all.mjs
// Needs ANTHROPIC_API_KEY in .env.local (or the environment). A file already in data/extract-cache is
// answered from the cache and never sent to the model again. The key is read by the extractor only; this script never prints it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInvoice } from "../src/extract/extractInvoice.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env.local"));
} catch {
  // no .env.local: the key may already be in the environment, and cached files need none
}

const MIME = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const dir = path.join(root, "brim_ap_dataset", "incoming_invoices");
const cacheDir = path.join(root, "data", "extract-cache"); // the same cache the app reads
const files = fs.readdirSync(dir).filter((f) => MIME[path.extname(f).toLowerCase()]).sort();

// 123456 -> "1234.56", integer math only.
const money = (c) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

const rows = new Array(files.length);
const reasons = [];
let next = 0;
let cached = 0;
// A few at a time: the model call is slow, the cache is instant.
async function worker() {
  while (next < files.length) {
    const i = next++;
    const file = files[i];
    const res = await extractInvoice(fs.readFileSync(path.join(dir, file)), MIME[path.extname(file).toLowerCase()], { cacheDir });
    if (res.status === "ok") {
      if (res.cached) cached++;
      const x = res.invoice;
      rows[i] = { file, status: "ok", vendor: x.vendorName, invoice_number: x.invoiceNumber, total: `${money(x.totalCents)} ${x.currency}` };
    } else {
      reasons.push(`${file}: ${res.reason}`);
      rows[i] = { file, status: "needs_review", vendor: "", invoice_number: "", total: "" };
    }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));

console.table(rows);
const bad = rows.filter((r) => r.status !== "ok").length;
console.log(`${files.length} files: ${rows.length - bad} ok (${cached} from cache), ${bad} needs_review`);
for (const r of reasons.sort()) console.log(`  needs_review ${r}`);

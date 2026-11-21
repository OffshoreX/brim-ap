// Builds a temp DB with generated invoices (default 42,000 = 100x the dataset) and times the hot queries,
// first without db/scale.sql, then with it. Usage: node scripts/bench.mjs [invoiceCount]
// The SQL below mirrors pipeline.ts (duplicate lookup), invoices.ts (list page) and views.ts (dashboard).
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const N = Number(process.argv[2] || 42000);
const VENDORS = Math.max(10, Math.round(N / 84));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brim-bench-"));
const db = new Database(path.join(dir, "bench.db"));
db.pragma("journal_mode = WAL");
db.pragma("synchronous = OFF");
const files = fs.readdirSync("db").filter((f) => f.endsWith(".sql") && f !== "schema.sql" && f !== "scale.sql").sort();
for (const f of ["schema.sql", ...files]) db.exec(fs.readFileSync(path.join("db", f), "utf8"));

// Generated data only: vendor ids, numbers and amounts come from a counter and a seeded pseudo-random walk.
let seed = 12345;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
const statuses = ["received", "needs_review", "pending_approval", "approved", "scheduled", "rejected", "paid"];
db.pragma("foreign_keys = OFF");
db.transaction(() => {
  db.prepare("INSERT INTO users (id,name,role) VALUES (1,'Bench User','controller_admin')").run();
  const v = db.prepare("INSERT INTO vendors (id,name) VALUES (?,?)");
  for (let i = 1; i <= VENDORS; i++) v.run(i, `Generated Vendor ${i}`);
  const inv = db.prepare(
    `INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,due_date,total_cents,currency,total_cad_cents,requester_id)
     VALUES (?,?,?,?,?,?,?,'CAD',?,1)`
  );
  const aud = db.prepare("INSERT INTO audit_log (at,actor_id,action,entity,entity_id,after) VALUES (?,1,'invoice.extracted','invoice',?,'{}')");
  const pay = db.prepare("INSERT INTO payments (invoice_id,vendor_id,status,scheduled_date,amount_cents,currency) VALUES (?,?,?,?,?,'CAD')");
  for (let i = 1; i <= N; i++) {
    const day = new Date(Date.UTC(2026, 0, 1) + rnd(330) * 86400000).toISOString().slice(0, 10);
    const total = 1000 + rnd(5_000_000);
    const status = statuses[rnd(statuses.length)];
    inv.run(i, status, 1 + rnd(VENDORS), `GEN-${String(i).padStart(7, "0")}`, day, day, total, total);
    aud.run(`${day}T12:00:00.000Z`, String(i));
    if (status === "scheduled" || status === "paid") pay.run(i, 1, status === "paid" ? "settled" : "scheduled", day, total);
  }
})();
db.exec("ANALYZE");

const ms = (fn, reps = 20) => {
  fn(); // warm the page cache
  const t = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) fn();
  return Number(process.hrtime.bigint() - t) / 1e6 / reps;
};
const probe = db.prepare("SELECT vendor_id, invoice_number, invoice_date, total_cents FROM invoices WHERE id = ?").get(Math.floor(N / 2));
const dup = db.prepare("SELECT id, invoice_number, total_cents, invoice_date FROM invoices WHERE vendor_id = ? AND id != ? AND invoice_number != ''");
const exact = db.prepare("SELECT id FROM invoices WHERE vendor_id = ? AND invoice_number = ? AND id != ?");
const list = db.prepare("SELECT id,status,vendor_id,invoice_number,invoice_date,total_cents FROM invoices WHERE status = 'needs_review' ORDER BY id LIMIT 50 OFFSET 0");
const listAll = db.prepare("SELECT id,status,vendor_id,invoice_number,invoice_date,total_cents FROM invoices ORDER BY id LIMIT 50 OFFSET 0");
const dashA = db.prepare("SELECT status, COUNT(*) n FROM invoices i WHERE 1 = 1 GROUP BY status");
const dashB = db.prepare("SELECT COALESCE(SUM(COALESCE(total_cad_cents, CASE WHEN currency = 'CAD' THEN total_cents END)), 0) AS c FROM invoices i WHERE 1 = 1 AND status NOT IN ('paid','rejected') AND due_date >= ? AND due_date <= ?");
const auditPage = db.prepare("SELECT id FROM audit_log WHERE entity = 'invoice' ORDER BY at DESC, id DESC LIMIT 50 OFFSET 0");
const trail = db.prepare("SELECT id FROM audit_log WHERE entity = 'invoice' AND entity_id = ? ORDER BY at, id");

function run(label) {
  const r = {
    "duplicate check (same vendor)": ms(() => dup.all(probe.vendor_id, Math.floor(N / 2))),
    "exact duplicate lookup": ms(() => exact.all(probe.vendor_id, probe.invoice_number, Math.floor(N / 2))),
    "invoice list page (needs_review, 50)": ms(() => list.all()),
    "invoice list page (all, 50)": ms(() => listAll.all()),
    "dashboard summary": ms(() => { dashA.all(); dashB.get("2026-06-01", "2026-06-07"); }, 5),
    "audit page (newest 50)": ms(() => auditPage.all()),
    "invoice audit trail": ms(() => trail.all(String(Math.floor(N / 2)))),
  };
  console.log(`\n${label}`);
  for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(40)} ${v.toFixed(3)} ms`);
}

console.log(`invoices: ${N}, vendors: ${VENDORS}, audit rows: ${N}`);
run("WITHOUT db/scale.sql (only primary keys and UNIQUE columns)");
db.exec(fs.readFileSync("db/scale.sql", "utf8"));
db.exec("ANALYZE");
run("WITH db/scale.sql");
db.close();
fs.rmSync(dir, { recursive: true, force: true });

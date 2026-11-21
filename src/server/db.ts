import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { backfillAuditChain } from "./audit";

// schema.sql first (users), then every other *.sql alphabetically, so later tickets only add files.
export function applySchema(d: Database.Database, dir = path.join(process.cwd(), "db")) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== "schema.sql").sort();
  for (const f of ["schema.sql", ...files]) d.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  // An audit_log without the hash columns is an older database: chain its existing rows once, right after the columns are added.
  const auditCols = d.prepare("PRAGMA table_info(audit_log)").all() as { name: string }[];
  const needsChain = auditCols.length > 0 && !auditCols.some((c) => c.name === "row_hash");
  addMissingColumns(d);
  if (needsChain) backfillAuditChain(d);
}

// CREATE TABLE IF NOT EXISTS never alters an existing file, so columns added later are listed here.
const ADDED_COLUMNS: [string, string, string][] = [
  ["invoice_lines", "coding_source", "TEXT"],
  ["invoice_lines", "coding_reason", "TEXT"],
  ["invoice_lines", "coding_needed", "INTEGER NOT NULL DEFAULT 0 CHECK (coding_needed IN (0,1))"],
  ["users", "password_hash", "TEXT"],
  ["audit_log", "prev_hash", "TEXT"],
  ["audit_log", "row_hash", "TEXT"],
];
function addMissingColumns(d: Database.Database) {
  for (const [table, col, def] of ADDED_COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.length && !cols.some((c) => c.name === col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

let db: Database.Database | undefined;

// One connection per process; schema is idempotent so a fresh file just works.
export function getDb(): Database.Database {
  if (!db) {
    const file = process.env.DB_PATH || "data/app.db";
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    applySchema(db);
  }
  return db;
}

export function resetDbForTests() {
  db?.close();
  db = undefined;
}

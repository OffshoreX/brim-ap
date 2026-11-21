// Fake users, one per role. Replaced by the real dataset import later.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const file = process.env.DB_PATH || "data/app.db";
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
// Same order as applySchema in src/server/db.ts: schema.sql first, then the rest alphabetically.
for (const f of ["schema.sql", ...fs.readdirSync("db").filter((f) => f.endsWith(".sql") && f !== "schema.sql").sort()])
  db.exec(fs.readFileSync(path.join("db", f), "utf8"));

const users = [
  [1, "Erin Employee", "employee", 4, 0, "QC"],
  [2, "Carl Clerk", "ap_clerk", 4, 0, "QC"],
  [3, "Alex Approver", "approver", 5, 500000, "ON"],
  [4, "Fiona Finance", "finance_manager", 5, 2500000, "QC"],
  [5, "Cora Controller", "controller_admin", null, 100000000, "QC"],
  [6, "Aaron Auditor", "auditor", null, 0, "QC"],
];
const insert = db.prepare(
  "INSERT OR REPLACE INTO users (id, name, role, manager_id, approval_limit_cents, province) VALUES (?,?,?,?,?,?)"
);
db.pragma("foreign_keys = OFF"); // manager ids point forward within this batch
db.transaction(() => users.forEach((u) => insert.run(...u)))();
console.log(`Seeded ${users.length} users into ${file}`);

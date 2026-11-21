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
  [1, "Erin Employee", "employee", 4, 0, "QC", "erin.employee@harborline-logistics.example"],
  [2, "Carl Clerk", "ap_clerk", 4, 0, "QC", "carl.clerk@harborline-logistics.example"],
  [3, "Alex Approver", "approver", 5, 500000, "ON", "alex.approver@harborline-logistics.example"],
  [4, "Fiona Finance", "finance_manager", 5, 2500000, "QC", "fiona.finance@harborline-logistics.example"],
  [5, "Cora Controller", "controller_admin", null, 100000000, "QC", "cora.controller@harborline-logistics.example"],
  [6, "Aaron Auditor", "auditor", null, 0, "QC", "aaron.auditor@harborline-logistics.example"],
];
const insert = db.prepare(
  "INSERT OR REPLACE INTO users (id, name, role, manager_id, approval_limit_cents, province, email) VALUES (?,?,?,?,?,?,?)"
);
db.pragma("foreign_keys = OFF"); // manager ids point forward within this batch
db.transaction(() => users.forEach((u) => insert.run(...u)))();
// Node 24 runs this TypeScript file as is (password.ts imports only node:crypto). Every user gets the demo password; it is not printed.
const { setDemoPasswords } = await import("../src/server/password.ts");
setDemoPasswords(db);
console.log(`Seeded ${users.length} users into ${file}`);

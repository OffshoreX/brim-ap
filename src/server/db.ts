import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// schema.sql first (users), then every other *.sql alphabetically, so later tickets only add files.
export function applySchema(d: Database.Database, dir = path.join(process.cwd(), "db")) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== "schema.sql").sort();
  for (const f of ["schema.sql", ...files]) d.exec(fs.readFileSync(path.join(dir, f), "utf8"));
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

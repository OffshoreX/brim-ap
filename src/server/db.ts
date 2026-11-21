import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let db: Database.Database | undefined;

// One connection per process; schema is idempotent so a fresh file just works.
export function getDb(): Database.Database {
  if (!db) {
    const file = process.env.DB_PATH || "data/app.db";
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    for (const f of ["db/schema.sql", "db/domain.sql"])
      db.exec(fs.readFileSync(path.join(process.cwd(), f), "utf8"));
  }
  return db;
}

export function resetDbForTests() {
  db?.close();
  db = undefined;
}

// Loads the real dataset into the database: node scripts/import-dataset.mjs (safe to run again).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { register } from "node:module";

// The server code is TypeScript with extensionless imports. Plain Node needs one flag and a 1-line resolver to run it as is.
if (!process.execArgv.includes("--experimental-transform-types")) {
  const r = spawnSync(process.execPath, ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && s.startsWith(".")) return next(s + ".ts", c); throw e; } }`
));

const { applySchema } = await import("../src/server/db.ts");
const { importDataset } = await import("../src/server/importDataset.ts");

const file = process.env.DB_PATH || "data/app.db";
if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
applySchema(db);
const summary = importDataset(db);
console.log(`Imported dataset into ${file}`);
console.table(summary);

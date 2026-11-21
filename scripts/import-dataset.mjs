// Loads the real dataset into the database: node scripts/import-dataset.mjs (safe to run again).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { applySchema } from "../src/server/db.ts";
import { importDataset } from "../src/server/importDataset.ts";

const file = process.env.DB_PATH || "data/app.db";
if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
applySchema(db);
const summary = importDataset(db);
console.log(`Imported dataset into ${file}`);
console.table(summary);

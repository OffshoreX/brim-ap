// Deletes the disposable database and reseeds it: node scripts/reset-db.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = process.env.DB_PATH || "data/app.db";
fs.rmSync(file, { force: true });
execFileSync("node", ["scripts/seed.mjs"], { stdio: "inherit" });

execFileSync("node", ["scripts/import-dataset.mjs"], { stdio: "inherit" }); // real data replaces the fake seed users

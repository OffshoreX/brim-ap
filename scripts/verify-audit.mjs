// Checks the audit hash chain of the local database: node scripts/verify-audit.mjs   (DB_PATH overrides data/app.db)
// Exit code 0 = chain intact, 1 = tampering found, 2 = no database. Read-only apart from the one-off chaining of an older database.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

// The server code is TypeScript with extensionless imports. Plain Node needs one flag and a 1-line resolver to run it as is.
if (!process.execArgv.includes("--experimental-transform-types")) {
  const r = spawnSync(process.execPath, ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && s.startsWith(".")) return next(s + ".ts", c); throw e; } }`
));

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const file = process.env.DB_PATH || "data/app.db";
if (file !== ":memory:" && !fs.existsSync(file)) {
  console.error(`No database at ${file}. Run: npm run seed`);
  process.exit(2);
}

const { getDb } = await import("../src/server/db.ts");
const { verifyAuditChain } = await import("../src/server/audit.ts");
const v = verifyAuditChain(getDb());
console.log(v.ok ? `OK: ${v.rowCount} audit rows, chain intact. Head hash: ${v.headHash || "(empty log)"}` : `BROKEN at audit row id ${v.brokenAtId} (row ${v.rowCount} in order): ${v.reason}`);
process.exit(v.ok ? 0 : 1);

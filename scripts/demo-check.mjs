// Runs only the three demo scenarios (tests/e2e/demoScenarios.test.ts) and prints PASS or FAIL for each.
// Run before any push: node scripts/demo-check.mjs   Exit code 0 = all three pass, 1 = any failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "demo-check-")), "result.json"); // outside the repo, nothing left behind
const run = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "tests/e2e/demoScenarios.test.ts", "--reporter=json", `--outputFile=${out}`], {
  cwd: root, encoding: "utf8",
});

let tests = [];
try {
  tests = JSON.parse(fs.readFileSync(out, "utf8")).testResults.flatMap((f) => f.assertionResults);
} catch {
  console.log("FAIL: could not run the scenarios");
  console.log((run.stderr || run.stdout || "").trim().split("\n").slice(-15).join("\n"));
  process.exit(1);
}
fs.rmSync(path.dirname(out), { recursive: true, force: true });

for (const t of tests) console.log(`${t.status === "passed" ? "PASS" : "FAIL"}  ${t.title}`);
const failed = tests.filter((t) => t.status !== "passed");
for (const t of failed) console.log(`\n${t.title}\n  ${(t.failureMessages?.[0] ?? "no message").split("\n")[0]}`);
if (tests.length !== 3) console.log(`\nFAIL: expected 3 scenarios, found ${tests.length}`);
process.exit(failed.length === 0 && tests.length === 3 ? 0 : 1);

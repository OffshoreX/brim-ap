// One command for the demo: starts the API (Next, port 3000) and the web app (Vite) together, prefixes their logs,
// and stops both on Ctrl+C. Usage: npm run demo
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const web = path.join(root, "web");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// First run on a new machine: install web/ dependencies so nobody has to remember a second setup step.
if (!fs.existsSync(path.join(web, "node_modules"))) {
  console.log("[demo] installing web/ dependencies (first run only)...");
  const r = spawnSync(npm, ["install"], { cwd: web, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!fs.existsSync(path.join(root, ".env.local"))) console.log("[demo] warning: .env.local is missing (SESSION_SECRET is required to sign in)");

const children = [];
function run(label, args, cwd) {
  const p = spawn(npm, args, { cwd, env: { ...process.env, FORCE_COLOR: "0" } });
  const tag = `[${label}] `;
  for (const s of [p.stdout, p.stderr]) s.on("data", (d) => process.stdout.write(String(d).split("\n").filter(Boolean).map((l) => tag + l).join("\n") + "\n"));
  p.on("exit", (code) => { console.log(`${tag}exited with code ${code}`); stop(code ?? 1); });
  children.push(p);
}
function stop(code = 0) { for (const c of children) c.kill("SIGTERM"); setTimeout(() => process.exit(code), 300); }
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

run("api", ["run", "dev"], root);
run("web", ["run", "dev"], web);
console.log("[demo] open the address the [web] line prints (not port 3000). Ctrl+C stops both.");

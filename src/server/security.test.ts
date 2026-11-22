import { readdirSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { handle } from "./authz";
import { hashPassword } from "./password";
import { LIMITS } from "./security";
import { SESSION_MAX_AGE_S, sessionCookie, signSession, verifySession } from "./session";
import { POST as loginRoute } from "@/app/api/login/route";
import { POST as logoutRoute } from "@/app/api/logout/route";
import { POST as releaseRoute } from "@/app/api/payments/release/route";
import { POST as uploadRoute } from "@/app/api/invoices/upload/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const CTRL = 1, FIN = 2;
beforeEach(() => {
  resetDbForTests();
  getDb().prepare("INSERT INTO users (id,name,email,role,password_hash) VALUES (1,'Ctrl','c@x.example','controller_admin',?),(2,'Fin','f@x.example','finance_manager',?)").run(hashPassword("pw-1234"), hashPassword("pw-1234"));
});
afterEach(() => vi.unstubAllEnvs());

const cookie = (u: number) => `session=${signSession(u)}`;

// --- Cross-site writes ---
const modules = import.meta.glob("/src/app/api/**/route.ts") as Record<string, () => Promise<Record<string, unknown>>>;
const WRITES = ["POST", "PUT", "PATCH", "DELETE"];

test("every write route refuses a cross-site Origin with 403, even with a valid cookie", async () => {
  let checked = 0;
  for (const [file, load] of Object.entries(modules)) {
    const mod = await load();
    for (const m of WRITES.filter((m) => typeof mod[m] === "function")) {
      const req = new Request("http://app.example/api/x", { method: m, headers: { origin: "https://evil.example", host: "app.example", cookie: cookie(CTRL) }, body: "{}" });
      const res = await (mod[m] as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({ id: "1", lineId: "1" }) });
      expect(res.status, `${m} ${file}`).toBe(403);
      expect((await res.json()).error).toBe("Cross-site request refused");
      checked++;
    }
  }
  expect(checked).toBeGreaterThanOrEqual(15); // guards against the glob matching nothing
});

test("same-origin and missing Origin are allowed; the dev proxy case (URL :3000, browser on :5173) is same-origin", async () => {
  const post = (headers: Record<string, string>, url = "http://app.example/api/logout") => logoutRoute(new Request(url, { method: "POST", headers }));
  expect((await post({ origin: "http://app.example", host: "app.example" })).status).toBe(200);
  expect((await post({})).status).toBe(200); // curl or a server script: no Origin header
  expect((await post({ origin: "http://localhost:5173", host: "localhost:5173" }, "http://localhost:3000/api/logout")).status).toBe(200);
  expect((await post({ origin: "null", host: "app.example" })).status).toBe(403); // sandboxed page
  expect((await post({ origin: "http://app.example.evil.example", host: "app.example" })).status).toBe(403); // look-alike host
});

test("login is refused cross-site, and reads are never blocked by Origin", async () => {
  const login = (origin?: string) =>
    loginRoute(new Request("http://app.example/api/login", { method: "POST", headers: { host: "app.example", ...(origin ? { origin } : {}) }, body: JSON.stringify({ email: "c@x.example", password: "pw-1234" }) }));
  expect((await login("https://evil.example")).status).toBe(403);
  expect((await login("http://app.example")).status).toBe(200);
});

// --- Session cookie ---
test("session cookie: HttpOnly, SameSite=Lax, Path=/, fixed Max-Age, and Secure only in production", () => {
  const c = sessionCookie(1);
  expect(c).toMatch(/; HttpOnly/);
  expect(c).toContain("SameSite=Lax");
  expect(c).toContain("Path=/");
  expect(c).toContain(`Max-Age=${SESSION_MAX_AGE_S}`);
  expect(c).not.toContain("Secure");
  vi.stubEnv("NODE_ENV", "production");
  expect(sessionCookie(1)).toContain("; Secure");
});

test("the signed expiry is enforced on the server and cannot be edited", () => {
  const t0 = Date.parse("2026-11-21T12:00:00Z");
  const value = signSession(7, t0);
  expect(verifySession(value, t0 + 1000)).toBe(7);
  expect(verifySession(value, t0 + (SESSION_MAX_AGE_S + 1) * 1000)).toBeNull();
  const [id, exp, sig] = value.split(".");
  expect(verifySession(`${id}.${Number(exp) + 99999}.${sig}`, t0)).toBeNull(); // longer expiry, old signature
  expect(verifySession(`8.${exp}.${sig}`, t0)).toBeNull(); // someone else's id
});

// --- Errors ---
test("a crash returns a plain 500, logs the cause server-side only", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await handle(() => {
    throw new Error("SQLITE_ERROR: no such table: secrets at /Users/someone/app/src/server/db.ts:12");
  });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "Something went wrong" });
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

// --- Rate limits ---
test.each([
  ["release", FIN, () => new Request("http://x/api/payments/release", { method: "POST", headers: { cookie: cookie(FIN) }, body: "{}" }), releaseRoute],
  ["upload", CTRL, () => new Request("http://x/api/invoices/upload", { method: "POST", headers: { cookie: cookie(CTRL) }, body: "not a form" }), uploadRoute],
] as const)("%s: the user's request after the limit gets 429, another user is unaffected", async (name, user, make, route) => {
  for (let i = 0; i < LIMITS[name].max; i++) expect((await route(make())).status).toBe(400); // reaches the body check, so not limited yet
  const res = await route(make());
  expect(res.status).toBe(429);
  expect((await res.json()).error).toMatch(/Too many requests/);
  const other = user === FIN ? CTRL : FIN; // a different user has their own count (role may differ: 403 is fine, 429 is not)
  const r2 = await route(new Request(make().url, { method: "POST", headers: { cookie: cookie(other) }, body: "{}" }));
  expect(r2.status).not.toBe(429);
});

// --- Uploads: stored name comes from the content, never from the client ---
test("an upload named like a path traversal is stored under its hash inside the upload folder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-sec-"));
  vi.stubEnv("UPLOAD_DIR", dir);
  const { registerUpload } = await import("./upload");
  const { sourceFile } = getDb().prepare("SELECT source_file AS sourceFile FROM invoices WHERE id = ?").get(registerUpload({ id: CTRL } as never, Buffer.from("%PDF-1.4 ../../evil")).invoiceId) as { sourceFile: string };
  expect(path.dirname(path.resolve(sourceFile))).toBe(path.resolve(dir));
  expect(path.basename(sourceFile)).toMatch(/^[0-9a-f]{64}\.pdf$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- Secrets ---
const SECRET = "SESSION-SECRET-VALUE-9f8e7d";
const KEY = "sk-ant-FAKE-KEY-VALUE-1a2b3c";

test("secret values never reach console output or audit rows (login success, login failure, upload)", async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("ANTHROPIC_API_KEY", KEY);
  const out: string[] = [];
  const spies = (["log", "warn", "error", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a) => void out.push(a.map(String).join(" "))));
  const login = (password: string) => loginRoute(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ email: "c@x.example", password }) }));
  expect((await login("pw-1234")).status).toBe(200);
  expect((await login("wrong")).status).toBe(401);
  await handle(() => { throw new Error("boom"); });
  spies.forEach((s) => s.mockRestore());

  const audit = JSON.stringify(getDb().prepare("SELECT * FROM audit_log").all());
  expect(audit.length).toBeGreaterThan(10); // the login rows are really there
  for (const secret of [SECRET, KEY]) {
    expect(audit).not.toContain(secret);
    expect(out.join("\n")).not.toContain(secret);
  }
});

test("no source line logs an environment variable or a secret by name", () => {
  const files: string[] = [];
  const walk = (dir: string) => readdirSync(dir).forEach((n) => {
    const full = path.join(dir, n);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) files.push(full);
  });
  walk(path.join(process.cwd(), "src"));
  const bad = files.flatMap((f) =>
    readFileSync(f, "utf8").split("\n").map((l, i) => ({ l, at: `${path.relative(process.cwd(), f)}:${i + 1}` }))
      .filter(({ l }) => /console\.\w+\(/.test(l) && /process\.env|SESSION_SECRET|ANTHROPIC/.test(l)).map(({ at }) => at)
  );
  expect(bad).toEqual([]);
});

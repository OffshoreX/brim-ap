import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { getDb, resetDbForTests } from "@/server/db";
import { signSession } from "@/server/session";
import { hashPassword } from "@/server/password";
import { MATRIX, ROLES } from "./authz-matrix";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";
process.env.DEMO_PERSONA_PICKER = "1"; // the matrix calls /api/users and login; the off state has its own tests below

const API_DIR = path.join(process.cwd(), "src/app/api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const modules = import.meta.glob("/src/app/api/**/route.ts") as Record<string, () => Promise<Record<string, unknown>>>;

// Every route.ts under src/app/api, as "invoices/[id]" style folders.
function discover(dir = API_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return discover(full);
    return name === "route.ts" ? [path.relative(API_DIR, dir)] : [];
  });
}

const userId = (role: string) => ROLES.indexOf(role as (typeof ROLES)[number]) + 1;

beforeEach(() => {
  resetDbForTests();
  const ins = getDb().prepare("INSERT INTO users (id, name, role) VALUES (?,?,?)");
  for (const r of ROLES) ins.run(userId(r), r, r);
});

test("every route and method has a row in the matrix (no route ships without a decision)", async () => {
  const rows = new Set(MATRIX.map(([route, method]) => `${method} ${route}`));
  const found: string[] = [];
  for (const route of discover()) {
    const mod = await modules[`/src/app/api/${route}/route.ts`]();
    for (const m of METHODS) if (typeof mod[m] === "function") found.push(`${m} ${route}`);
  }
  expect(found.filter((r) => !rows.has(r))).toEqual([]);
  expect([...rows].filter((r) => !found.includes(r))).toEqual([]); // stale rows too
});

function call(route: string, method: string, cookie?: string) {
  const url = `http://x/api/${route.replace("[id]", "999999")}`;
  const req = new Request(url, { method, headers: cookie ? { cookie } : {}, body: method === "GET" ? undefined : "{}" });
  return modules[`/src/app/api/${route}/route.ts`]().then((mod) =>
    (mod[method] as (r: Request, c: unknown) => Promise<Response> | Response)(req, { params: Promise.resolve({ id: "999999" }) })
  );
}

describe.each(MATRIX)("%s %s", (route, method, access) => {
  if (access === "public") {
    test("works with no cookie", async () => {
      const s = (await call(route, method)).status;
      expect([401, 403]).not.toContain(s);
    });
    return;
  }
  test("no cookie -> 401", async () => {
    expect((await call(route, method)).status).toBe(401);
  });
  for (const role of ROLES) {
    const ok = access.includes(role);
    test(`${role} -> ${ok ? "allowed" : "403"}`, async () => {
      const s = (await call(route, method, `session=${signSession(userId(role))}`)).status;
      if (ok) {
        expect([401, 403]).not.toContain(s);
        expect(s).toBeLessThan(500);
      } else expect(s).toBe(403);
    });
  }
});

describe("cookie integrity", () => {
  const me = (cookie: string) => call("me", "GET", cookie);
  test("forged signature, swapped id, junk and empty cookies -> 401", async () => {
    const good = signSession(userId("employee"));
    const [, sig] = good.split(".");
    for (const c of [`session=${userId("controller_admin")}.${sig}`, "session=1.bogus", "session=1", "session=", "session=..", `session=${good}x`])
      expect((await me(c)).status).toBe(401);
  });
  test("cookie signed with another secret -> 401", async () => {
    const good = signSession(1);
    process.env.SESSION_SECRET = "other";
    const foreign = signSession(1);
    process.env.SESSION_SECRET = "test-secret";
    expect(foreign).not.toBe(good);
    expect((await me(`session=${foreign}`)).status).toBe(401);
  });
  test("role comes from the DB, not the cookie: demoting a user takes effect immediately", async () => {
    const cookie = `session=${signSession(userId("controller_admin"))}`;
    expect((await call("admin/ping", "GET", cookie)).status).toBe(200);
    getDb().prepare("UPDATE users SET role='employee' WHERE id = ?").run(userId("controller_admin"));
    expect((await call("admin/ping", "GET", cookie)).status).toBe(403);
  });
  test("terminated user cannot log in and an old cookie stops working", async () => {
    const cookie = `session=${signSession(userId("approver"))}`;
    expect((await me(cookie)).status).toBe(200);
    getDb().prepare("UPDATE users SET status='terminated', email='t@x.example', password_hash=? WHERE id = ?").run(hashPassword("pw"), userId("approver"));
    expect((await me(cookie)).status).toBe(401);
    const res = await passwordLogin("t@x.example", "pw"); // right password, still refused
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

const passwordLogin = async (email: string, password: string) =>
  (await import("@/app/api/login/route")).POST(new Request("http://x/api/login", { method: "POST", headers: { "x-forwarded-for": "5.5.5.5" }, body: JSON.stringify({ email, password }) }));

describe("password login (no persona picker)", () => {
  beforeEach(() => {
    delete process.env.DEMO_PERSONA_PICKER;
    getDb().prepare("UPDATE users SET email = id || '@x.example', password_hash = ?").run(hashPassword("pw"));
  });
  const cookieFor = async (role: string) => (await passwordLogin(`${userId(role)}@x.example`, "pw")).headers.get("set-cookie")!.split(";")[0];

  test("each role signs in by password and then gets exactly the access the matrix gives it", async () => {
    for (const role of ROLES) {
      const cookie = await cookieFor(role);
      expect((await call("me", "GET", cookie)).status).toBe(200);
      expect((await call("admin/ping", "GET", cookie)).status).toBe(role === "controller_admin" ? 200 : 403);
    }
  });
  test("a tampered cookie from a real login is still rejected", async () => {
    const good = await cookieFor("employee");
    const [id, sig] = good.replace("session=", "").split(".");
    for (const c of [`session=${id}.${sig.slice(0, -1)}A`, `session=${userId("controller_admin")}.${sig}`, `${good}.x`])
      expect((await call("me", "GET", c)).status).toBe(401);
  });
  test("role is read from the DB on every request, so a demotion applies to an existing login", async () => {
    const cookie = await cookieFor("controller_admin");
    getDb().prepare("UPDATE users SET role='auditor' WHERE id = ?").run(userId("controller_admin"));
    expect((await call("admin/ping", "GET", cookie)).status).toBe(403);
  });
  test("the old login-by-userId path is 404 and sets no cookie while the picker is off", async () => {
    const res = await (await import("@/app/api/login/route")).POST(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ userId: userId("controller_admin") }) }));
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await call("users", "GET")).status).toBe(404);
  });
});

describe("row-level rules", () => {
  test("employee list shows only own invoices; auditor sees all", async () => {
    const d = getDb();
    d.prepare("INSERT INTO invoices (id, status, invoice_number, invoice_date, total_cents, currency, requester_id) VALUES (1,'received','A','2026-01-01',100,'CAD',?),(2,'received','B','2026-01-01',100,'CAD',?)")
      .run(userId("employee"), userId("approver"));
    const ids = async (role: string) =>
      ((await (await call("invoices", "GET", `session=${signSession(userId(role))}`)).json()) as { id: number }[] | { invoices: { id: number }[] });
    const list = async (role: string) => { const j = await ids(role); return (Array.isArray(j) ? j : j.invoices).map((i) => i.id); };
    expect(await list("employee")).toEqual([1]);
    expect(await list("auditor")).toEqual([1, 2]);
  });
});

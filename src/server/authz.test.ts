import { handle, HttpError } from "./authz";
import { beforeEach, expect, test } from "vitest";
import { resetDbForTests, getDb } from "./db";
import { signSession } from "./session";
import { GET as adminPing } from "@/app/api/admin/ping/route";
import { POST as login } from "@/app/api/login/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";
process.env.DEMO_PERSONA_PICKER = "1"; // these tests cover the old login-by-userId path; login.test.ts covers it being off

const req = (cookie?: string) =>
  new Request("http://x/api/admin/ping", { headers: cookie ? { cookie } : {} });

beforeEach(() => {
  resetDbForTests();
  getDb()
    .prepare("INSERT INTO users (id, name, role) VALUES (1,'Cora','controller_admin'),(2,'Erin','employee')")
    .run();
});

test("no cookie -> 401", async () => {
  expect((await adminPing(req())).status).toBe(401);
});

test("forged cookie -> 401", async () => {
  expect((await adminPing(req("session=1.bogus"))).status).toBe(401);
});

test("wrong role -> 403", async () => {
  expect((await adminPing(req(`session=${signSession(2)}`))).status).toBe(403);
});

test("right role -> 200", async () => {
  expect((await adminPing(req(`session=${signSession(1)}`))).status).toBe(200);
});

test("login sets HttpOnly cookie and writes an audit row", async () => {
  const res = await login(new Request("http://x/api/login", { method: "POST", body: '{"userId":1}' }));
  expect(res.headers.get("set-cookie")).toMatch(/^session=1\..+HttpOnly/);
  const row = getDb().prepare("SELECT action, actor_id FROM audit_log").get();
  expect(row).toEqual({ action: "login", actor_id: 1 });
});

const badLogin = (body: string) => login(new Request("http://x/api/login", { method: "POST", body }));

test("login with bad body -> 400", async () => {
  for (const body of ["", "not json", "null", "[]", "{}", '{"userId":"abc"}', '{"userId":1.5}'])
    expect((await badLogin(body)).status).toBe(400);
});

test("audit_log rejects UPDATE and DELETE but allows INSERT", () => {
  const db = getDb();
  db.prepare("INSERT INTO audit_log (action, entity) VALUES ('x','y')").run();
  expect(() => db.prepare("UPDATE audit_log SET action='z'").run()).toThrow(/append-only/);
  expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
});

test("async handler throwing 403 -> 403 response", async () => {
  const res = await handle(async () => {
    throw new HttpError(403, "Forbidden");
  });
  expect(res.status).toBe(403);
});

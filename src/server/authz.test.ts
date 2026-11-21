import { beforeEach, expect, test } from "vitest";
import { resetDbForTests, getDb } from "./db";
import { signSession } from "./session";
import { GET as adminPing } from "@/app/api/admin/ping/route";
import { POST as login } from "@/app/api/login/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const req = (cookie?: string) =>
  new Request("http://x/api/admin/ping", { headers: cookie ? { cookie } : {} });

beforeEach(() => {
  resetDbForTests();
  getDb()
    .prepare("INSERT INTO users (id, name, role) VALUES (1,'Cora','controller_admin'),(2,'Erin','employee')")
    .run();
});

test("no cookie -> 401", async () => {
  expect(adminPing(req()).status).toBe(401);
});

test("forged cookie -> 401", async () => {
  expect(adminPing(req("session=1.bogus")).status).toBe(401);
});

test("wrong role -> 403", async () => {
  expect(adminPing(req(`session=${signSession(2)}`)).status).toBe(403);
});

test("right role -> 200", async () => {
  expect(adminPing(req(`session=${signSession(1)}`)).status).toBe(200);
});

test("login sets HttpOnly cookie and writes an audit row", async () => {
  const res = await login(new Request("http://x/api/login", { method: "POST", body: '{"userId":1}' }));
  expect(res.headers.get("set-cookie")).toMatch(/^session=1\..+HttpOnly/);
  const row = getDb().prepare("SELECT action, actor_id FROM audit_log").get();
  expect(row).toEqual({ action: "login", actor_id: 1 });
});

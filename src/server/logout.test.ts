import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { sessionCookie } from "./session";
import { POST } from "@/app/api/logout/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

beforeEach(() => {
  resetDbForTests();
  getDb().prepare("INSERT INTO users (id, name, role) VALUES (1,'Erin','employee')").run();
});

const post = (cookie?: string) => POST(new Request("http://x/api/logout", { method: "POST", headers: cookie ? { cookie } : {} }));
const audit = () => getDb().prepare("SELECT actor_id, action, entity_id FROM audit_log").all();

test("clears the session cookie with the same name, path and flags as sessionCookie", async () => {
  const res = await post(sessionCookie(1).split(";")[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  const c = res.headers.get("set-cookie")!;
  expect(c).toMatch(/^session=;/);
  expect(c).toContain("Max-Age=0");
  for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/"]) expect(c).toContain(flag);
});

test("writes one audit row saying who logged out", async () => {
  await post(sessionCookie(1).split(";")[0]);
  expect(audit()).toMatchObject([{ actor_id: 1, action: "logout", entity_id: "1" }]);
});

test("works with no session or a forged one: 200, cookie cleared, no audit row", async () => {
  for (const cookie of [undefined, "session=1.forged"]) {
    const res = await post(cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  }
  expect(audit()).toEqual([]);
});

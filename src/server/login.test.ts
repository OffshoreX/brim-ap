import { afterEach, beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { attemptLogin } from "./login";
import { createLimiter } from "./loginLimiter";
import { hashPassword, setDemoPasswords } from "./password";
import { POST as loginRoute } from "@/app/api/login/route";
import { GET as usersRoute } from "@/app/api/users/route";
import { GET as meRoute } from "@/app/api/me/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const PW = "s3cret-pw";
const try_ = (email: string, password = PW, ip = "1.1.1.1", limiter = createLimiter()) => attemptLogin({ email, password, ip }, limiter);

beforeEach(() => {
  resetDbForTests();
  const ins = getDb().prepare("INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?,?,?,?,?,?)");
  const h = hashPassword(PW);
  ins.run(1, "Erin", "erin@x.example", "employee", "active", h);
  ins.run(2, "Tom", "tom@x.example", "approver", "terminated", h);
  ins.run(3, "Lea", "lea@x.example", "approver", "on_leave", h);
});
afterEach(() => {
  delete process.env.DEMO_PERSONA_PICKER;
  delete process.env.DEMO_PASSWORD;
});

test("right email and password signs in; email is case-insensitive; on_leave can log in", () => {
  expect(try_("erin@x.example")).toMatchObject({ status: 200, user: { id: 1, role: "employee" } });
  expect(try_("  ERIN@X.example ").status).toBe(200);
  expect(try_("lea@x.example").status).toBe(200);
});

test("wrong password, unknown email and terminated user all get the same 401 message", () => {
  const a = try_("erin@x.example", "nope");
  const b = try_("nobody@x.example");
  const c = try_("tom@x.example"); // correct password, but terminated
  expect(a).toEqual({ status: 401, error: "Invalid email or password" });
  expect(b).toEqual(a);
  expect(c).toEqual(a);
});

test("5 failures per email lock it (429, even with the right password) until 10 minutes pass", () => {
  let t = 0;
  const l = createLimiter(() => t);
  for (let i = 0; i < 5; i++) expect(try_("erin@x.example", "bad", `9.9.9.${i}`, l).status).toBe(401);
  expect(try_("erin@x.example", PW, "8.8.8.8", l).status).toBe(429);
  t += 10 * 60 * 1000;
  expect(try_("erin@x.example", PW, "8.8.8.8", l).status).toBe(200);
});

test("5 failures from one IP lock that IP, whatever email is tried", () => {
  const l = createLimiter();
  for (let i = 0; i < 5; i++) try_(`ghost${i}@x.example`, "bad", "7.7.7.7", l);
  expect(try_("erin@x.example", PW, "7.7.7.7", l).status).toBe(429);
  expect(try_("erin@x.example", PW, "6.6.6.6", l).status).toBe(200); // other IPs are fine
});

test("success, failure and lockout each write an audit row, and no row contains a password", () => {
  const l = createLimiter();
  try_("erin@x.example", PW, "1.1.1.1", l);
  for (let i = 0; i < 5; i++) try_("erin@x.example", "wrong-" + PW, "2.2.2.2", l);
  try_("erin@x.example", PW, "2.2.2.2", l); // 429: not audited again, so an attacker cannot flood the log
  const rows = getDb().prepare("SELECT actor_id, action, after FROM audit_log ORDER BY id").all() as { actor_id: number | null; action: string; after: string }[];
  expect(rows.map((r) => r.action)).toEqual(["login_success", ...Array(5).fill("login_failed"), "login_lockout"]);
  expect(rows[0].actor_id).toBe(1);
  expect(JSON.parse(rows[1].after)).toMatchObject({ outcome: "bad_password", email: "erin@x.example" });
  expect(JSON.parse(rows[6].after).locked.sort()).toEqual(["email", "ip"]);
  expect(JSON.stringify(rows)).not.toContain(PW);
});

test("a password typed into the email box is not copied into the audit log", () => {
  try_("my-password-123", "x");
  const after = getDb().prepare("SELECT after FROM audit_log").get() as { after: string };
  expect(after.after).not.toContain("my-password-123");
});

const post = (body: unknown, ip = "3.3.3.3") =>
  loginRoute(new Request("http://x/api/login", { method: "POST", headers: { "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) }));

test("route: cookie from a password login works on /api/me and /api/me never shows the hash", async () => {
  const res = await post({ email: "erin@x.example", password: PW });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  const me = await meRoute(new Request("http://x/api/me", { headers: { cookie } }));
  const body = await me.json();
  expect(body.user).toMatchObject({ id: 1, role: "employee" });
  expect(JSON.stringify(body)).not.toContain("password_hash");
  expect(JSON.stringify(body)).not.toContain("scrypt");
});

test("route: bad bodies are 400 and a role in the body is ignored", async () => {
  for (const b of ["", "nope", "null", "[]", "{}", { email: "a@b.c" }, { email: 1, password: "x" }, { email: "a@b.c", password: "x".repeat(2000) }])
    expect((await post(b)).status).toBe(400);
  const res = await post({ email: "erin@x.example", password: PW, role: "controller_admin" });
  expect((await res.json()).user.role).toBe("employee");
});

test("persona picker is off by default: login by userId and /api/users both 404 and set no cookie", async () => {
  const res = await post({ userId: 1 });
  expect(res.status).toBe(404);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(usersRoute(new Request("http://x/api/users")).status).toBe(404);
});

test("persona picker works again with DEMO_PERSONA_PICKER=1", async () => {
  process.env.DEMO_PERSONA_PICKER = "1";
  const res = await post({ userId: 1 });
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toMatch(/^session=1\./);
  expect(usersRoute(new Request("http://x/api/users")).status).toBe(200);
});

test("setDemoPasswords gives every user the demo password (DEMO_PASSWORD overrides the fallback)", () => {
  setDemoPasswords(getDb());
  expect(try_("erin@x.example", "harborline-demo").status).toBe(200);
  expect(try_("erin@x.example", PW).status).toBe(401);
  process.env.DEMO_PASSWORD = "custom-demo";
  setDemoPasswords(getDb());
  expect(try_("lea@x.example", "custom-demo").status).toBe(200);
});

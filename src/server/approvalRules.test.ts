import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { loadApprovalRules } from "./approvalRules";
import { routeApproval } from "./rules/approval";
import { GET, POST } from "@/app/api/admin/approval-rules/route";
import { PUT, DELETE } from "@/app/api/admin/approval-rules/[id]/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const call = (fn: Function, cookie: string | undefined, body?: unknown, id?: number) =>
  fn(
    new Request("http://x/api/admin/approval-rules", {
      method: body === undefined ? "GET" : "POST",
      headers: cookie ? { cookie } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  ) as Promise<Response>;
const admin = () => `session=${signSession(1)}`;
const rule = (min: number, max: number, role = "approver", department: string | null = "ops") => ({
  department, min_cents: min, max_cents: max, approver_role: role,
});
const audits = () => getDb().prepare("SELECT action, before, after FROM audit_log WHERE action LIKE 'approval_rule.%'").all() as { action: string; before: string | null; after: string | null }[];

beforeEach(() => {
  resetDbForTests();
  getDb().prepare("INSERT INTO users (id, name, role) VALUES (1,'Cora','controller_admin'),(2,'Erin','employee')").run();
});

test("non-admin gets 403, anonymous 401, on every verb", async () => {
  const erin = `session=${signSession(2)}`;
  for (const fn of [GET, POST, PUT, DELETE]) {
    expect((await call(fn, erin, rule(0, 10), 1)).status).toBe(403);
    expect((await call(fn, undefined, rule(0, 10), 1)).status).toBe(401);
  }
});

test("rejects min >= max, bad role and non-integer cents with 400", async () => {
  for (const bad of [rule(10, 5), rule(5, 5), rule(0, 10, "wizard"), { ...rule(0, 10), min_cents: 1.5 }])
    expect((await call(POST, admin(), bad)).status).toBe(400);
});

test("overlap rejected per department; touching ranges and other departments are fine", async () => {
  expect((await call(POST, admin(), rule(0, 100))).status).toBe(201);
  expect((await call(POST, admin(), rule(50, 150))).status).toBe(400);
  expect((await call(POST, admin(), rule(100, 200))).status).toBe(201); // [0,100) and [100,200) touch, no overlap
  expect((await call(POST, admin(), rule(0, 100, "approver", "hr"))).status).toBe(201);
});

test("update rejects overlap but allows editing a rule onto its own range", async () => {
  await call(POST, admin(), rule(0, 100));
  await call(POST, admin(), rule(100, 200));
  expect((await call(PUT, admin(), rule(0, 150), 1)).status).toBe(400);
  expect((await call(PUT, admin(), rule(0, 100, "finance_manager"), 1)).status).toBe(200);
});

test("create, update and delete each write an audit row with before/after", async () => {
  await call(POST, admin(), rule(0, 100));
  await call(PUT, admin(), rule(0, 100, "finance_manager"), 1);
  await call(DELETE, admin(), {}, 1);
  const a = audits();
  expect(a.map((r) => r.action)).toEqual(["approval_rule.create", "approval_rule.update", "approval_rule.delete"]);
  expect(a[0]).toMatchObject({ before: null });
  expect(JSON.parse(a[1].before!).approver_role).toBe("approver");
  expect(JSON.parse(a[1].after!).approver_role).toBe("finance_manager");
  expect(a[2].after).toBeNull();
  expect((await call(DELETE, admin(), {}, 1)).status).toBe(404);
});

test("loadApprovalRules feeds routeApproval and picks the right role at the boundary", async () => {
  await call(POST, admin(), rule(0, 100_001, "approver"));
  await call(POST, admin(), rule(100_001, 1_000_000, "finance_manager"));
  const off = await (await call(POST, admin(), rule(1_000_000, 2_000_000, "controller_admin"))).json();
  await call(PUT, admin(), { ...rule(1_000_000, 2_000_000, "controller_admin"), active: false }, off.rule.id);

  const rules = loadApprovalRules();
  expect(rules).toHaveLength(2); // inactive rule is not loaded
  const users = [
    { id: "a", role: "approver", limitCents: 100_000 },
    { id: "f", role: "finance_manager", limitCents: 1_000_000 },
    { id: "req", role: "employee", limitCents: 0 },
  ];
  const route = (totalCents: number) => routeApproval({ totalCents, department: "ops" }, users[2], users, rules);
  expect(route(100_000)).toMatchObject({ status: "routed", approverId: "a" });
  expect(route(100_001)).toMatchObject({ status: "routed", approverId: "f" });
  expect(route(1_000_000)).toMatchObject({ status: "needs_review" }); // inactive rule, nothing matches
});

import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { loadThresholds } from "./approvalRules";
import { GET } from "@/app/api/admin/approval-rules/route";
import { PUT } from "@/app/api/admin/approval-rules/[id]/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const call = (fn: Function, cookie: string | undefined, body?: unknown, id = 1) =>
  fn(
    new Request("http://x/api/admin/approval-rules", {
      method: body === undefined ? "GET" : "PUT",
      headers: cookie ? { cookie } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  ) as Promise<Response>;
const admin = () => `session=${signSession(1)}`;
const audits = () => getDb().prepare("SELECT action, actor_id, before, after FROM audit_log WHERE action LIKE 'approval_rule.%' ORDER BY id").all() as {
  action: string; actor_id: number | null; before: string | null; after: string | null;
}[];
const list = async () => (await (await call(GET, admin())).json()).rules as { id: number; policy_id: string; over_cents: number; extra_role: string }[];

beforeEach(() => {
  resetDbForTests();
  getDb().exec(`
    INSERT INTO users (id, name, role) VALUES (1,'Cora','controller_admin'),(2,'Erin','employee');
    INSERT INTO approval_policies (ext_id,rule_type,condition,required) VALUES
      ('P01','approval','Invoice total up to $10,000 CAD','dept_manager'),
      ('P02','approval','Invoice total over $10,000 CAD','dept_manager > finance_manager'),
      ('P03','approval','Invoice total over $50,000 CAD','dept_manager > finance_manager > controller_admin'),
      ('P04','approval','Invoice total over $250,000 CAD','dept_manager > finance_manager > controller_admin > cfo'),
      ('P05','approval','Vendor status is pending_review or the vendor is new','finance_manager');
  `);
});

test("non-admin gets 403, anonymous 401, on both verbs", async () => {
  const erin = `session=${signSession(2)}`;
  for (const fn of [GET, PUT]) {
    expect((await call(fn, erin, { over_cents: 1 })).status).toBe(403);
    expect((await call(fn, undefined, { over_cents: 1 })).status).toBe(401);
  }
});

test("thresholds are seeded from the 'Invoice total over' policies, in integer cents, and audited", async () => {
  expect(await list()).toMatchObject([
    { policy_id: "P02", over_cents: 1_000_000, extra_role: "finance_manager" },
    { policy_id: "P03", over_cents: 5_000_000, extra_role: "controller_admin" },
    { policy_id: "P04", over_cents: 25_000_000, extra_role: "cfo" },
  ]);
  expect(audits().map((a) => [a.action, a.actor_id])).toEqual([["approval_rule.seed", null], ["approval_rule.seed", null], ["approval_rule.seed", null]]);
  expect(loadThresholds()).toEqual({ financeOverCents: 1_000_000, controllerOverCents: 5_000_000, cfoOverCents: 25_000_000 });
});

test("seeding runs once: an edit survives the next read", async () => {
  const [fin] = await list();
  await call(PUT, admin(), { over_cents: 2_000_000 }, fin.id);
  expect((await list())[0].over_cents).toBe(2_000_000);
  expect(audits().filter((a) => a.action === "approval_rule.seed")).toHaveLength(3);
});

test("without policies there are no thresholds, and loading them fails instead of guessing", () => {
  getDb().exec("DELETE FROM approval_policies");
  expect(() => loadThresholds()).toThrow(/no threshold/);
});

test("rejects non-integer, negative, missing and out-of-order amounts with 400; unknown id 404", async () => {
  const [fin] = await list();
  for (const bad of [{ over_cents: 1.5 }, { over_cents: -1 }, { over_cents: "5" }, {}, { over_cents: 5_000_001 }])
    expect((await call(PUT, admin(), bad, fin.id)).status).toBe(400); // 5,000,001 would pass the controller level
  expect((await call(PUT, admin(), { over_cents: 1 }, 999)).status).toBe(404);
  expect(await list()).toMatchObject([{ over_cents: 1_000_000 }, { over_cents: 5_000_000 }, { over_cents: 25_000_000 }]);
});

test("an edit writes an audit row with before, after and who", async () => {
  const [fin] = await list();
  const res = await call(PUT, admin(), { over_cents: 1_500_000 }, fin.id);
  expect(res.status).toBe(200);
  const last = audits().at(-1)!;
  expect(last).toMatchObject({ action: "approval_rule.update", actor_id: 1 });
  expect(JSON.parse(last.before!).over_cents).toBe(1_000_000);
  expect(JSON.parse(last.after!).over_cents).toBe(1_500_000);
});

test("a controller cannot edit their own tier or the CFO tier above it: 403, nothing changes, nothing audited", async () => {
  const [, ctrl, cfo] = await list();
  const before = audits().length;
  for (const r of [ctrl, cfo]) {
    const res = await call(PUT, admin(), { over_cents: r.over_cents + 1 }, r.id);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("This rule applies to your own role. Another controller reviews changes to it.");
  }
  expect((await list()).map((r) => r.over_cents)).toEqual([1_000_000, 5_000_000, 25_000_000]);
  expect(audits()).toHaveLength(before);
});

test("the finance tier stays editable by a controller (the audit row above records before and after)", async () => {
  const [fin] = await list();
  expect((await call(PUT, admin(), { over_cents: 2_000_000 }, fin.id)).status).toBe(200);
});

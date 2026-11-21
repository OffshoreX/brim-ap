import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { POST as decide } from "@/app/api/invoices/[id]/decision/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// 1 clerk (requester), 2 approver (rule role, on leave in some tests), 3 delegate approver,
// 4 other approver, 5 employee.
beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id,name,role,approval_limit_cents,delegate_id) VALUES
     (1,'Clerk','ap_clerk',0,NULL),(2,'Ann','approver',1000000,3),(3,'Del','approver',1000000,NULL),
     (4,'Oth','finance_manager',0,NULL),(5,'Emp','employee',0,NULL)`
  ).run();
  db.prepare("INSERT INTO vendors (id,name) VALUES (1,'Acme')").run();
  db.prepare("INSERT INTO approval_rules (min_cents,max_cents,approver_role) VALUES (0,10000000,'approver')").run();
  db.prepare(
    `INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,total_cents,currency,requester_id) VALUES
     (1,'pending_approval',1,'INV-1','2026-01-01',5000,'CAD',1),
     (2,'pending_approval',1,'INV-2','2026-01-01',5000,'CAD',2),
     (3,'received',1,'INV-3','2026-01-01',5000,'CAD',1)`
  ).run();
});

const post = (user: number, id: number, body: unknown) =>
  decide(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { cookie: `session=${signSession(user)}` } }), {
    params: Promise.resolve({ id: String(id) }),
  });
const status = (id: number) => (getDb().prepare("SELECT status FROM invoices WHERE id=?").get(id) as { status: string }).status;

test("employee gets 403 from the role gate", async () => {
  expect((await post(5, 1, { decision: "approved", comment: "" })).status).toBe(403);
});

test("requester cannot decide own invoice, even with an approver role", async () => {
  const res = await post(2, 2, { decision: "approved", comment: "mine" });
  expect(res.status).toBe(403);
  expect(status(2)).toBe("pending_approval");
});

test("wrong approver gets 403 and nothing changes", async () => {
  expect((await post(4, 1, { decision: "approved", comment: "" })).status).toBe(403);
  expect(status(1)).toBe("pending_approval");
  expect(getDb().prepare("SELECT COUNT(*) c FROM approvals").get()).toEqual({ c: 0 });
});

test.each(["approved", "rejected"] as const)("right approver %s writes approvals and audit rows", async (decision) => {
  const res = await post(2, 1, { decision, comment: "ok" });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: decision, delegated: false });
  expect(status(1)).toBe(decision);
  expect(getDb().prepare("SELECT approver_id, decision, comment, delegated FROM approvals WHERE invoice_id=1").all()).toEqual([
    { approver_id: 2, decision, comment: "ok", delegated: 0 },
  ]);
  const actions = (getDb().prepare("SELECT action FROM audit_log WHERE entity='invoice' ORDER BY id").all() as { action: string }[]).map((a) => a.action);
  expect(actions).toEqual(["approval.decide", "invoice.status"]);
});

test("on-leave approver's delegate can decide and is marked delegated; the approver cannot", async () => {
  getDb().prepare("UPDATE users SET on_leave = 1 WHERE id = 2").run();
  expect((await post(2, 1, { decision: "approved", comment: "" })).status).toBe(403);
  const res = await post(3, 1, { decision: "approved", comment: "covering" });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ delegated: true, delegatedFromId: 2 });
  expect(getDb().prepare("SELECT approver_id, delegated, delegated_from_id FROM approvals").all()).toEqual([
    { approver_id: 3, delegated: 1, delegated_from_id: 2 },
  ]);
});

test("non-pending invoice gets 409, unknown id 404, bad body 400", async () => {
  expect((await post(2, 3, { decision: "approved", comment: "" })).status).toBe(409);
  expect((await post(2, 99, { decision: "approved", comment: "" })).status).toBe(404);
  expect((await post(2, 1, { decision: "maybe" })).status).toBe(400);
});

test("a second decision on the same invoice gets 409", async () => {
  expect((await post(2, 1, { decision: "approved", comment: "" })).status).toBe(200);
  expect((await post(2, 1, { decision: "rejected", comment: "" })).status).toBe(409);
});

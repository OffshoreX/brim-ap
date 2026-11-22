import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { createChain } from "./approvals";
import { POST as decide } from "@/app/api/invoices/[id]/decision/route";
import { PUT as editRule } from "@/app/api/admin/approval-rules/[id]/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// 1 CFO (top, no manager) > 2 controller > 3 finance manager > 4 dept manager (approver) > 5 requester.
// 6 is an unrelated approver, 7 is the dept manager's delegate, 8 a second employee.
beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.exec(`
    INSERT INTO users (id,name,role,manager_id,department_id) VALUES
      (1,'Cfo','controller_admin',NULL,NULL),(2,'Ctrl','controller_admin',1,NULL),(3,'Fin','finance_manager',2,NULL),
      (4,'Dept','approver',3,NULL),(5,'Req','employee',4,NULL),(6,'Oth','approver',3,NULL),(7,'Del','approver',3,NULL),(8,'Emp','employee',4,NULL);
    INSERT INTO departments (id,name,manager_user_id) VALUES (1,'Ops',4);
    UPDATE users SET department_id = 1;
    INSERT INTO vendors (id,name,category,status,onboarded_at) VALUES (1,'Acme','Freight','active','2020-01-01');
    INSERT INTO approval_policies (ext_id,rule_type,condition,required) VALUES
      ('P02','approval','Invoice total over $10,000 CAD','dept_manager > finance_manager'),
      ('P03','approval','Invoice total over $50,000 CAD','dept_manager > finance_manager > controller_admin'),
      ('P04','approval','Invoice total over $250,000 CAD','dept_manager > finance_manager > controller_admin > cfo');
  `);
});

// Inserts a pending_approval invoice and stores its chain, the way processing does.
let n = 0;
const invoice = (totalCents: number, requester = 5) => {
  const id = Number(
    getDb()
      .prepare("INSERT INTO invoices (status,vendor_id,invoice_number,invoice_date,total_cents,currency,requester_id) VALUES ('pending_approval',1,?,?,?,'CAD',?)")
      .run(`INV-${++n}`, "2026-11-01", totalCents, requester).lastInsertRowid
  );
  createChain(id, null);
  return id;
};
const post = (user: number, id: number, body: unknown) =>
  decide(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { cookie: `session=${signSession(user)}` } }), {
    params: Promise.resolve({ id: String(id) }),
  });
const ok = (user: number, id: number, decision = "approved") => post(user, id, { decision, comment: "c" });
const status = (id: number) => (getDb().prepare("SELECT status FROM invoices WHERE id=?").get(id) as { status: string }).status;
const steps = (id: number) => getDb().prepare("SELECT step_no, user_id, status FROM approval_steps WHERE invoice_id=? ORDER BY step_no").all(id);
const DOLLARS = 100;

test("employee gets 403 from the role gate", async () => {
  expect((await ok(5, invoice(5000))).status).toBe(403);
});

test("the chain is stored as pending steps with role and user", () => {
  const id = invoice(15_000 * DOLLARS);
  expect(getDb().prepare("SELECT step_no, role, user_id, status FROM approval_steps WHERE invoice_id=? ORDER BY step_no").all(id)).toEqual([
    { step_no: 1, role: "dept_manager", user_id: 4, status: "pending" },
    { step_no: 2, role: "finance_manager", user_id: 3, status: "pending" },
  ]);
});

test("requester cannot decide their own invoice, even with an approver role", async () => {
  const id = invoice(5000, 4); // the department manager is the requester, so the chain starts at their manager
  expect(steps(id)).toEqual([{ step_no: 1, user_id: 3, status: "pending" }]);
  expect((await ok(4, id)).status).toBe(403);
  expect(status(id)).toBe("pending_approval");
});

test("out-of-order approver gets 403, one with no step on the invoice gets 404, and nothing changes", async () => {
  const id = invoice(15_000 * DOLLARS);
  expect((await ok(3, id)).status).toBe(403); // step 2 user tries first
  expect((await ok(6, id)).status).toBe(404); // not in the chain at all: the invoice is invisible to them, so no 403 that confirms it exists
  expect(status(id)).toBe("pending_approval");
  expect(getDb().prepare("SELECT COUNT(*) c FROM approvals").get()).toEqual({ c: 0 });
});

test("exactly 10,000 needs one approval; over 10,000 needs two, in order", async () => {
  const one = invoice(10_000 * DOLLARS);
  expect(await (await ok(4, one)).json()).toMatchObject({ status: "approved", nextApproverId: null });

  const two = invoice(10_000 * DOLLARS + 1);
  const first = await (await ok(4, two)).json();
  expect(first).toMatchObject({ status: "pending_approval", stepNo: 1, nextApproverId: 3 });
  expect(status(two)).toBe("pending_approval");
  expect((await ok(4, two)).status).toBe(409); // step 1 is done and user 4 already decided it: a repeat is 409 (T57)
  expect(await (await ok(3, two)).json()).toMatchObject({ status: "approved", stepNo: 2, nextApproverId: null });
  expect(status(two)).toBe("approved");
  expect(getDb().prepare("SELECT step_no, approver_id, approver_role, decision FROM approvals WHERE invoice_id=? ORDER BY step_no").all(two)).toEqual([
    { step_no: 1, approver_id: 4, approver_role: "dept_manager", decision: "approved" },
    { step_no: 2, approver_id: 3, approver_role: "finance_manager", decision: "approved" },
  ]);
});

test("reject at step 2 sets rejected, skips the rest and ends the chain", async () => {
  const id = invoice(60_000 * DOLLARS); // dept manager, finance manager, controller
  await ok(4, id);
  expect(await (await ok(3, id, "rejected")).json()).toMatchObject({ status: "rejected", decision: "rejected", stepNo: 2, nextApproverId: null });
  expect(status(id)).toBe("rejected");
  expect(steps(id)).toEqual([
    { step_no: 1, user_id: 4, status: "approved" },
    { step_no: 2, user_id: 3, status: "rejected" },
    { step_no: 3, user_id: 2, status: "skipped" },
  ]);
  expect((await ok(2, id)).status).toBe(409);
});

test("a delegate's decision is marked delegated; the approver on leave cannot decide", async () => {
  getDb().prepare("UPDATE users SET status='on_leave', delegate_user_id=7 WHERE id=4").run();
  const id = invoice(5000);
  expect((await ok(4, id)).status).toBe(404); // the step is the delegate's, so the invoice is not visible to the approver on leave
  expect(await (await ok(7, id)).json()).toMatchObject({ delegated: true, delegatedFromId: 4, status: "approved" });
  expect(getDb().prepare("SELECT approver_id, approver_role, delegated, delegated_from_id FROM approvals").all()).toEqual([
    { approver_id: 7, approver_role: "dept_manager", delegated: 1, delegated_from_id: 4 },
  ]);
});

test("each decision writes an audit row with before and after; the last one also logs the status change", async () => {
  const id = invoice(15_000 * DOLLARS);
  await ok(4, id);
  await ok(3, id);
  const rows = getDb().prepare("SELECT action, actor_id, before, after FROM audit_log WHERE entity='invoice' AND entity_id=? AND action != 'invoice.routed' ORDER BY id").all(String(id)) as {
    action: string; actor_id: number; before: string; after: string;
  }[];
  expect(rows.map((r) => [r.action, r.actor_id])).toEqual([["approval.decide", 4], ["approval.decide", 3], ["invoice.status", 3]]);
  expect(JSON.parse(rows[0].before)).toMatchObject({ stepNo: 1, stepStatus: "pending" });
  expect(JSON.parse(rows[0].after)).toMatchObject({ stepNo: 1, stepStatus: "approved", delegated: false });
});

test("editing a threshold changes the next chain", async () => {
  const before = invoice(15_000 * DOLLARS);
  expect(steps(before)).toHaveLength(2);
  const rule = getDb().prepare("SELECT id FROM approval_rules WHERE extra_role='finance_manager'").get() as { id: number };
  const put = await editRule(
    new Request("http://x", { method: "PUT", body: JSON.stringify({ over_cents: 20_000 * DOLLARS }), headers: { cookie: `session=${signSession(1)}` } }),
    { params: Promise.resolve({ id: String(rule.id) }) }
  );
  expect(put.status).toBe(200);
  expect(steps(before)).toHaveLength(2); // the stored chain of an earlier invoice does not move
  expect(steps(invoice(15_000 * DOLLARS))).toHaveLength(1); // the next one follows the new threshold
});

test("a chain nobody can fill throws, and stores nothing", () => {
  getDb().prepare("UPDATE users SET status='terminated' WHERE id=3").run(); // the only finance manager
  expect(() => invoice(15_000 * DOLLARS)).toThrow();
  expect(getDb().prepare("SELECT COUNT(*) c FROM approval_steps").get()).toEqual({ c: 0 });
});

test("non-pending invoice gets 409, unknown id 404, bad body 400, and a finished invoice stays closed", async () => {
  const done = invoice(5000);
  await ok(4, done);
  expect((await ok(4, done)).status).toBe(409);
  getDb().prepare("INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,total_cents,currency,requester_id) VALUES (900,'received',1,'X','2026-01-01',1,'CAD',5)").run();
  getDb().prepare("INSERT INTO approval_steps (invoice_id, step_no, role, user_id, status) VALUES (900,1,'dept_manager',4,'pending')").run(); // visible to user 4, wrong status
  expect((await ok(4, 900)).status).toBe(409);
  expect((await ok(4, 99)).status).toBe(404);
  expect((await post(4, invoice(5000), { decision: "maybe" })).status).toBe(400);
});

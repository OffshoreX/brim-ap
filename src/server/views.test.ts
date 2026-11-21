import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { createChain, decideInvoice } from "./approvals";
import { dashboard } from "./views";
import { GET as detail } from "@/app/api/invoices/[id]/route";
import { GET as trail } from "@/app/api/invoices/[id]/trail/route";
import { GET as audit } from "@/app/api/audit/route";
import { GET as inbox } from "@/app/api/approvals/inbox/route";
import { GET as dash } from "@/app/api/dashboard/route";
import { GET as payments } from "@/app/api/payments/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// Users: 1 Emp1, 2 Emp2, 3 Clerk, 4 Appr (dept manager of Ops), 5 Fin, 6 Admin, 7 Aud, 8 other approver.
// Invoice 1: Emp1's, pending_approval, step 1 = Appr. Invoice 2: Emp2's, needs_review.
beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.exec(`
    INSERT INTO users (id,name,role,manager_id) VALUES
      (6,'Admin','controller_admin',NULL),(5,'Fin','finance_manager',6),(4,'Appr','approver',5),(8,'Appr2','approver',5),
      (1,'Emp1','employee',4),(2,'Emp2','employee',4),(3,'Clerk','ap_clerk',5),(7,'Aud','auditor',NULL);
    INSERT INTO departments (id,name,manager_user_id) VALUES (1,'Ops',4);
    UPDATE users SET department_id = 1;
    INSERT INTO vendors (id,name,category,status,onboarded_at,bank_account) VALUES (1,'Acme','Freight','active','2020-01-01','SECRET123');
    INSERT INTO approval_policies (ext_id,rule_type,condition,required) VALUES
      ('P02','approval','Invoice total over $10,000 CAD','dept_manager > finance_manager'),
      ('P03','approval','Invoice total over $50,000 CAD','dept_manager > finance_manager > controller_admin'),
      ('P04','approval','Invoice total over $250,000 CAD','dept_manager > finance_manager > controller_admin > cfo');
    INSERT INTO gl_accounts (id,code,name) VALUES (1,'5100','Freight');
    INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,due_date,total_cents,currency,total_cad_cents,requester_id,flags) VALUES
      (1,'pending_approval',1,'A-1','2026-11-01','2026-11-24',50000,'CAD',50000,1,'[{"code":"tax_mismatch","message":"GST off"}]'),
      (2,'needs_review',1,'A-2','2026-11-01','2026-12-30',70000,'CAD',70000,2,'["vendor_unmatched"]');
    INSERT INTO invoice_lines (invoice_id,line_no,description,unit_price_cents,amount_cents,currency,gl_account_id,gst_hst_code) VALUES (1,1,'Freight',50000,50000,'CAD',1,'GST5');
    INSERT INTO payments (id,invoice_id,vendor_id,method,status,paid_at,amount_cents,currency) VALUES (1,1,1,'EFT','scheduled',NULL,50000,'CAD');
  `);
  createChain(1, null);
});

const get = (route: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>, u: number | null, id = "1", q = "") =>
  route(new Request("http://x/" + q, { headers: u ? { cookie: `session=${signSession(u)}` } : {} }), { params: Promise.resolve({ id }) });
const list = (route: (r: Request) => Promise<Response>, u: number | null, q = "") =>
  route(new Request("http://x/" + q, { headers: u ? { cookie: `session=${signSession(u)}` } : {} }));

test("detail: content, no bank details, each role sees only what it may", async () => {
  const res = await get(detail, 3);
  const d = await res.json();
  expect(d.invoiceNumber).toBe("A-1");
  expect(d.flags).toEqual([{ code: "tax_mismatch", message: "GST off" }]);
  expect(d.lines[0]).toMatchObject({ glCode: "5100", gstHstCode: "GST5" });
  expect(d.approvalChain[0]).toMatchObject({ stepNo: 1, userId: 4, status: "pending" });
  expect(d.payments[0].status).toBe("scheduled");
  expect(JSON.stringify(d.vendor)).not.toContain("SECRET123");
  for (const u of [5, 6, 7, 4]) expect((await get(detail, u)).status).toBe(200);
  expect((await get(detail, 1)).status).toBe(200); // own
  expect((await get(detail, 2)).status).toBe(404); // someone else's
  expect((await get(detail, 8)).status).toBe(404); // approver with no step
  expect((await get(detail, 3, "99")).status).toBe(404);
  expect((await get(detail, 3, "abc")).status).toBe(400);
  expect((await get(detail, null)).status).toBe(401);
});

test("trail: invoice and payment rows in time order; 403 for employee and approver", async () => {
  decideInvoice(getDb().prepare("SELECT * FROM users WHERE id = 4").get() as never, 1, "approved", "ok");
  getDb().prepare("INSERT INTO audit_log (actor_id,action,entity,entity_id) VALUES (3,'payment.prepare','payment','1')").run();
  const rows = await (await get(trail, 7)).json();
  expect(rows.map((r: { action: string }) => r.action)).toEqual(["invoice.routed", "approval.decide", "invoice.status", "payment.prepare"]);
  expect(rows[1].after.comment).toBe("ok");
  for (const u of [1, 4]) expect((await get(trail, u)).status).toBe(403);
  expect((await get(trail, 3, "99")).status).toBe(404);
});

test("audit: filters work; 403 for clerk, approver and employee", async () => {
  getDb().prepare("INSERT INTO audit_log (actor_id,action,entity,entity_id,at) VALUES (3,'x','vendor','1','2020-01-01T00:00:00Z')").run();
  const all = await (await list(audit, 7)).json();
  expect(all.length).toBeGreaterThan(1);
  expect((await (await list(audit, 6, "?entity=vendor")).json()).map((r: { action: string }) => r.action)).toEqual(["x"]);
  expect(await (await list(audit, 5, "?actor=3&to=2021-01-01")).json()).toHaveLength(1);
  expect(await (await list(audit, 5, "?limit=1")).json()).toHaveLength(1);
  expect((await list(audit, 7, "?limit=abc")).status).toBe(400);
  for (const u of [1, 3, 4]) expect((await list(audit, u)).status).toBe(403);
});

test("inbox: only the user's turn; 403 for employee", async () => {
  expect((await (await list(inbox, 4)).json()).map((r: { invoiceId: number }) => r.invoiceId)).toEqual([1]);
  expect(await (await list(inbox, 8)).json()).toEqual([]);
  for (const u of [1, 3, 7]) expect((await list(inbox, u)).status).toBe(403);
});

test("dashboard: counts, needs_review and due this week, scoped by role; 401 with no cookie", async () => {
  const d = await (await list(dash, 3)).json();
  expect(d.countsByStatus).toEqual({ pending_approval: 1, needs_review: 1 });
  expect(d.needsReview).toBe(1);
  expect(dashboard({ id: 3, role: "ap_clerk" } as never, "2026-11-20").dueThisWeekCadCents).toBe(50000);
  expect(dashboard({ id: 3, role: "ap_clerk" } as never, "2026-11-30").dueThisWeekCadCents).toBe(0);
  expect((await (await list(dash, 1)).json()).countsByStatus).toEqual({ pending_approval: 1 });
  expect((await (await list(dash, 8)).json()).countsByStatus).toEqual({});
  expect((await list(dash, null)).status).toBe(401); // every role may read it, so no 403 case
});

test("payments: content; 403 for employee and approver", async () => {
  const rows = await (await list(payments, 7)).json();
  expect(rows[0]).toMatchObject({ id: 1, invoiceNumber: "A-1", status: "scheduled", amountCents: 50000 });
  for (const u of [1, 4]) expect((await list(payments, u)).status).toBe(403);
});

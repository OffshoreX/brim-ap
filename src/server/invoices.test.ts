import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { GET as list } from "@/app/api/invoices/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

beforeEach(() => {
  resetDbForTests();
  getDb()
    .prepare(
      `INSERT INTO users (id,name,role) VALUES
       (1,'Emp1','employee'),(2,'Emp2','employee'),(3,'Clerk','ap_clerk'),(4,'Appr','approver'),
       (5,'Fin','finance_manager'),(6,'Admin','controller_admin'),(7,'Aud','auditor')`
    )
    .run();
});

const cookie = (u: number) => ({ cookie: `session=${signSession(u)}` });
const addInvoice = (requester: number) =>
  getDb().prepare("INSERT INTO invoices (status,invoice_number,invoice_date,total_cents,currency,requester_id) VALUES ('received','','',0,'CAD',?)").run(requester);
const ids = async (u: number) =>
  (await (await list(new Request("http://x", { headers: cookie(u) }))).json()).map((i: { id: number }) => i.id);

test("no cookie gets 401 on the list", async () => {
  expect((await list(new Request("http://x"))).status).toBe(401);
});

test("each role sees the right set", async () => {
  addInvoice(1);
  addInvoice(2);
  addInvoice(3);
  getDb().prepare("UPDATE invoices SET status='pending_approval' WHERE id=2").run();
  expect(await ids(1)).toEqual([1]);
  expect(await ids(2)).toEqual([2]);
  expect(await ids(4)).toEqual([2]);
  for (const u of [3, 5, 6, 7]) expect(await ids(u)).toEqual([1, 2, 3]);
});

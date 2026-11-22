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
  for (const u of [3, 5, 6, 7]) expect(await ids(u)).toEqual([3, 2, 1]);
});

// --- T65: status filter, newest first, counts, actorName ---
import { GET as counts } from "@/app/api/invoices/counts/route";
const addWith = (requester: number, status: string) =>
  getDb().prepare("INSERT INTO invoices (status,invoice_number,invoice_date,total_cents,currency,requester_id) VALUES (?,'','',0,'CAD',?)").run(status, requester);
const get = (path: string, u: number) => list(new Request(`http://x/api/invoices${path}`, { headers: cookie(u) }));

test("status filter applies in SQL, total follows the filter, newest first", async () => {
  for (const s of ["paid", "received", "paid", "paid"]) addWith(1, s);
  const res = await get("?status=paid&limit=2", 3);
  expect((await res.json()).map((i: { id: number }) => i.id)).toEqual([4, 3]);
  expect(res.headers.get("X-Total-Count")).toBe("3");
  expect((await ids(3))[0]).toBe(4);
});

test("unknown status is a 400", async () => {
  expect((await get("?status=bogus", 3)).status).toBe(400);
});

test("counts match list totals for a restricted employee and for a controller", async () => {
  for (const [r, s] of [[1, "paid"], [1, "received"], [2, "paid"], [2, "pending_approval"]] as const) addWith(r, s);
  for (const u of [1, 6]) {
    const c = await (await counts(new Request("http://x", { headers: cookie(u) }))).json();
    for (const [status, n] of Object.entries(c.byStatus))
      expect(Number((await get(`?status=${status}`, u)).headers.get("X-Total-Count"))).toBe(n);
    expect(c.total).toBe(Number((await get("", u)).headers.get("X-Total-Count")));
  }
  expect((await (await counts(new Request("http://x", { headers: cookie(1) }))).json()).total).toBe(2);
});

// --- T78: list rows carry vendorName, dueDate, flagCount from one query ---
test("rows carry vendor name, due date and flag count; unread rows get nulls; count and order unchanged", async () => {
  const db = getDb();
  db.prepare("INSERT INTO vendors (id,name) VALUES (1,'Acme Freight')").run();
  addWith(1, "received"); // id 1: unread, no vendor
  db.prepare(
    `INSERT INTO invoices (status,vendor_id,invoice_number,invoice_date,due_date,total_cents,currency,requester_id,flags)
     VALUES ('needs_review',1,'A-1','2026-11-01','2026-12-01',500,'CAD',1,?)`
  ).run(JSON.stringify([{ code: "dup", message: "m", severity: "error" }, "bare"]));
  const res = await get("", 3);
  const rows = await res.json();
  expect(rows.map((r: { id: number }) => r.id)).toEqual([2, 1]);
  expect(res.headers.get("X-Total-Count")).toBe("2");
  expect(rows[0]).toMatchObject({ vendorName: "Acme Freight", dueDate: "2026-12-01", flagCount: 2, invoiceNumber: "A-1", totalCents: 500 });
  expect(rows[1]).toMatchObject({ vendorName: null, dueDate: null, flagCount: 0 });
});

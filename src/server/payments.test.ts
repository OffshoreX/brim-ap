import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { formatCents } from "./payments";
import { signSession } from "./session";
import { POST as release } from "@/app/api/payments/release/route";
import { GET as eft } from "@/app/api/payments/eft-file/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id,name,role,approval_limit_cents) VALUES
     (1,'Ann','approver',99999999),(2,'Fin','finance_manager',100000),(3,'Aud','auditor',0),(4,'Emp','employee',0)`
  ).run();
  db.prepare("INSERT INTO vendors (id,name,bank_transit,bank_account) VALUES (1,'Acme, Inc','123','456')").run();
  db.prepare(
    `INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,total_cents,currency) VALUES
     (1,'approved',1,'INV-1',  '2026-01-01',12345,'CAD'),
     (2,'approved',1,'INV-2',  '2026-01-01',500000,'CAD'),
     (3,'pending_approval',1,'INV-3','2026-01-01',100,'CAD')`
  ).run();
});

const post = (user: number, body: unknown) =>
  release(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { cookie: `session=${signSession(user)}` } }));
const count = (sql: string) => (getDb().prepare(sql).get() as { n: number }).n;

test("approver gets 403", async () => {
  expect((await post(1, { invoiceId: 1 })).status).toBe(403);
});

test("over-limit gets a clear 403", async () => {
  const res = await post(2, { invoiceId: 2 });
  expect(res.status).toBe(403);
  expect((await res.json()).error).toMatch(/limit/);
});

test("unapproved invoice gets 409", async () => {
  expect((await post(2, { invoiceId: 3 })).status).toBe(409);
});

test("bad body gets 400", async () => {
  expect((await post(2, { invoiceId: "x" })).status).toBe(400);
});

test("success: one payment, one payment audit row, invoice paid; second release 409", async () => {
  expect((await post(2, { invoiceId: 1 })).status).toBe(200);
  expect(count("SELECT COUNT(*) n FROM payments")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE entity='payment'")).toBe(1);
  expect(getDb().prepare("SELECT status FROM invoices WHERE id=1").get()).toEqual({ status: "paid" });
  expect((await post(2, { invoiceId: 1 })).status).toBe(409);
  expect(count("SELECT COUNT(*) n FROM payments")).toBe(1);
});

test("EFT csv: roles and exact amounts", async () => {
  await post(2, { invoiceId: 1 });
  const get = (u: number) => eft(new Request("http://x", { headers: { cookie: `session=${signSession(u)}` } }));
  expect((await get(4)).status).toBe(403);
  const res = await get(3);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe(
    'invoice_number,vendor,bank_details,amount,currency,reference\nINV-1,"Acme, Inc",123-456,123.45,CAD,PAY-1\n'
  );
});

test("formatCents", () => {
  expect([formatCents(0), formatCents(5), formatCents(100), formatCents(12345)]).toEqual(["0.00", "0.05", "1.00", "123.45"]);
});

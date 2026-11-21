import { beforeEach, expect, test } from "vitest";
import type { User } from "@/contracts";
import { getDb, resetDbForTests } from "./db";
import { formatCents, releasePayment } from "./payments";
import { signSession } from "./session";
import { POST as prepare } from "@/app/api/payments/prepare/route";
import { POST as release } from "@/app/api/payments/release/route";
import { GET as eft } from "@/app/api/payments/eft-file/route";
import { GET as cheques } from "@/app/api/payments/cheques/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// 1 approver, 2 finance_manager, 3 auditor, 4 employee, 5 ap_clerk, 6 controller_admin, 7 second finance_manager
beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id,name,role,approval_limit_cents) VALUES
     (1,'Ann','approver',99999999),(2,'Fin','finance_manager',0),(3,'Aud','auditor',0),(4,'Emp','employee',0),
     (5,'Clk','ap_clerk',0),(6,'Ctl','controller_admin',0),(7,'Fin2','finance_manager',0)`
  ).run();
  db.prepare("INSERT INTO vendors (id,name,address,bank_transit,bank_account) VALUES (1,'Acme, Inc','1 Main St','123','456')").run();
  addInvoice(1, 12345);
  addInvoice(3, 100, "pending_approval");
});

function addInvoice(id: number, totalCents: number, status = "approved", extra: { currency?: string; cad?: number | null; subtotal?: number; date?: string; vendor?: number } = {}) {
  getDb()
    .prepare(
      `INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,total_cents,currency,total_cad_cents,subtotal_cents)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(id, status, extra.vendor ?? 1, `INV-${id}`, extra.date ?? "2026-01-01", totalCents, extra.currency ?? "CAD", extra.cad ?? null, extra.subtotal ?? totalCents);
}
const approve = (invoiceId: number, userId: number) =>
  getDb().prepare("INSERT INTO approvals (invoice_id,approver_id,decision) VALUES (?,?,'approved')").run(invoiceId, userId);

const call = (fn: typeof prepare, user: number, body: unknown) =>
  fn(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { cookie: `session=${signSession(user)}` } }));
const prep = (user: number, body: unknown) => call(prepare, user, body);
const rel = (user: number, body: unknown) => call(release, user, body);
const count = (sql: string) => (getDb().prepare(sql).get() as { n: number }).n;
const row = (sql: string) => getDb().prepare(sql).get();
// Prepares invoice `id` as the clerk and returns the new payment id.
const prepared = async (id: number, body: object = {}) => ((await (await prep(5, { invoiceId: id, ...body })).json()) as { paymentId: number }).paymentId;
const asUser = (id: number) => getDb().prepare("SELECT * FROM users WHERE id=?").get(id) as User;

test("prepare: clerk schedules an approved invoice, nothing is paid yet", async () => {
  const res = await prep(5, { invoiceId: 1, method: "CHEQUE", scheduledDate: "2026-02-01" });
  expect(res.status).toBe(200);
  expect(row("SELECT status, method, scheduled_date, prepared_by, released_by, paid_at, amount_cents, amount_cad_cents FROM payments")).toEqual({
    status: "scheduled", method: "CHEQUE", scheduled_date: "2026-02-01", prepared_by: 5, released_by: null, paid_at: null, amount_cents: 12345, amount_cad_cents: 12345,
  });
  expect(row("SELECT status FROM invoices WHERE id=1")).toEqual({ status: "scheduled" });
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action='payment.prepare'")).toBe(1);
});

test("prepare: finance_manager and controller_admin may prepare; others get 403", async () => {
  expect((await prep(2, { invoiceId: 1 })).status).toBe(200);
  addInvoice(8, 100);
  expect((await prep(6, { invoiceId: 8 })).status).toBe(200);
  addInvoice(9, 100);
  for (const u of [1, 3, 4]) expect((await prep(u, { invoiceId: 9 })).status).toBe(403);
  expect(count("SELECT COUNT(*) n FROM payments")).toBe(2);
});

test("prepare: unapproved 409, double prepare 409, unknown 404, bad body 400", async () => {
  expect((await prep(5, { invoiceId: 3 })).status).toBe(409);
  expect((await prep(5, { invoiceId: 1 })).status).toBe(200);
  expect((await prep(5, { invoiceId: 1 })).status).toBe(409);
  expect((await prep(5, { invoiceId: 99 })).status).toBe(404);
  expect((await prep(5, { invoiceId: "x" })).status).toBe(400);
  expect((await prep(5, { invoiceId: 1, method: "BITCOIN" })).status).toBe(400);
  expect((await prep(5, { invoiceId: 1, scheduledDate: "tomorrow" })).status).toBe(400);
  expect(count("SELECT COUNT(*) n FROM payments")).toBe(1);
});

test("prepare: method defaults to the vendor's preferred method", async () => {
  getDb().prepare("UPDATE vendors SET preferred_payment_method='CHEQUE' WHERE id=1").run();
  await prep(5, { invoiceId: 1 });
  expect(row("SELECT method FROM payments")).toEqual({ method: "CHEQUE" });
});

test("prepare: foreign invoice without a CAD amount gets 409", async () => {
  addInvoice(8, 100, "approved", { currency: "USD" });
  expect((await prep(5, { invoiceId: 8 })).status).toBe(409);
});

test("clerk cannot release", async () => {
  const id = await prepared(1);
  const res = await rel(5, { paymentId: id });
  expect(res.status).toBe(403);
  expect(row("SELECT status FROM payments")).toEqual({ status: "scheduled" });
});

test("approver role cannot release; auditor and employee neither", async () => {
  const id = await prepared(1);
  for (const u of [1, 3, 4]) expect((await rel(u, { paymentId: id })).status).toBe(403);
  expect(row("SELECT status FROM payments")).toEqual({ status: "scheduled" });
});

test("the preparer cannot release their own payment", async () => {
  await prep(2, { invoiceId: 1 });
  const res = await rel(2, { paymentId: 1 });
  expect(res.status).toBe(403);
  expect((await res.json()).error).toMatch(/prepared/);
  expect((await rel(7, { paymentId: 1 })).status).toBe(200);
});

test("an approver of the invoice cannot release, even as finance_manager", async () => {
  approve(1, 7);
  const id = await prepared(1);
  const res = await rel(7, { paymentId: id });
  expect(res.status).toBe(403);
  expect((await res.json()).error).toMatch(/approved/);
  expect((await rel(2, { paymentId: id })).status).toBe(200);
});

test("finance_manager releases exactly 100,000.00 CAD but not one cent more", async () => {
  addInvoice(10, 10_000_000);
  addInvoice(11, 10_000_001);
  const edge = await prepared(10);
  const over = await prepared(11);
  expect((await rel(2, { paymentId: edge })).status).toBe(200);
  const res = await rel(2, { paymentId: over });
  expect(res.status).toBe(403);
  expect(row(`SELECT status FROM payments WHERE id=${over}`)).toEqual({ status: "scheduled" });
  expect((await rel(6, { paymentId: over })).status).toBe(200);
});

test("the limit compares the CAD amount, not the invoice currency", async () => {
  addInvoice(10, 8_000_000, "approved", { currency: "USD", cad: 10_000_001 });
  const id = await prepared(10);
  expect((await rel(2, { paymentId: id })).status).toBe(403);
  expect((await rel(6, { paymentId: id })).status).toBe(200);
});

test("success: row settled, invoice paid, audit rows; double release gets 409", async () => {
  const id = await prepared(1);
  expect((await rel(2, { paymentId: id })).status).toBe(200);
  expect(row("SELECT status, released_by, prepared_by FROM payments")).toEqual({ status: "settled", released_by: 2, prepared_by: 5 });
  expect(row("SELECT status FROM invoices WHERE id=1")).toEqual({ status: "paid" });
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action='payment.release'")).toBe(1);
  expect((await rel(2, { paymentId: id })).status).toBe(409);
  expect((await rel(6, { paymentId: id })).status).toBe(409);
  expect(count("SELECT COUNT(*) n FROM payments")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action='payment.release'")).toBe(1);
});

test("release: unknown payment 404, bad body 400", async () => {
  expect((await rel(2, { paymentId: 99 })).status).toBe(404);
  expect((await rel(2, { paymentId: "x" })).status).toBe(400);
});

test("CARD release gets a single-use virtual card reference; two cards differ", async () => {
  addInvoice(8, 100);
  const a = await prepared(1, { method: "CARD" });
  const b = await prepared(8, { method: "CARD" });
  const ra = (await (await rel(2, { paymentId: a })).json()).reference as string;
  const rb = (await (await rel(2, { paymentId: b })).json()).reference as string;
  expect(ra).toMatch(/^BRIM-VC-[0-9A-F]{10}$/);
  expect(ra).not.toBe(rb);
});

test("early-pay discount only inside the vendor's window", async () => {
  getDb().prepare("UPDATE vendors SET early_pay_discount='2/10 net 30' WHERE id=1").run();
  addInvoice(10, 207_945, "approved", { subtotal: 185_665, date: "2026-01-05" });
  addInvoice(11, 207_945, "approved", { subtotal: 185_665, date: "2026-01-05" });
  const inside = await prepared(10);
  const outside = await prepared(11);
  expect(releasePayment(asUser(2), inside, "2026-01-14").discountCents).toBe(3713);
  expect(row(`SELECT amount_cents, discount_taken_cents FROM payments WHERE id=${inside}`)).toEqual({ amount_cents: 204_232, discount_taken_cents: 3713 });
  expect(releasePayment(asUser(2), outside, "2026-01-16").discountCents).toBe(0);
  expect(row(`SELECT amount_cents, discount_taken_cents FROM payments WHERE id=${outside}`)).toEqual({ amount_cents: 207_945, discount_taken_cents: 0 });
});

test("EFT csv lists only released EFT payments, with exact amounts", async () => {
  addInvoice(8, 100);
  const cheque = await prepared(8, { method: "CHEQUE" });
  const eftId = await prepared(1, { method: "EFT" });
  await rel(2, { paymentId: cheque });
  const get = (u: number) => eft(new Request("http://x", { headers: { cookie: `session=${signSession(u)}` } }));
  expect((await get(4)).status).toBe(403);
  expect(await (await get(3)).text()).toBe("invoice_number,vendor,bank_details,amount,currency,reference\n"); // scheduled EFT and released cheque are both absent
  await rel(2, { paymentId: eftId });
  const res = await get(3);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe(
    `invoice_number,vendor,bank_details,amount,currency,reference\nINV-1,"Acme, Inc",123-456,123.45,CAD,PAY-${eftId}\n`
  );
});

test("cheque list: released cheques only, roles enforced", async () => {
  addInvoice(8, 5000);
  const chq = await prepared(8, { method: "CHEQUE" });
  await prepared(1, { method: "EFT" });
  const get = (u: number) => cheques(new Request("http://x", { headers: { cookie: `session=${signSession(u)}` } }));
  expect((await get(5)).status).toBe(403);
  expect((await (await get(3)).json()).cheques).toEqual([]);
  await rel(2, { paymentId: chq });
  expect((await (await get(3)).json()).cheques).toEqual([
    { paymentId: chq, invoiceNumber: "INV-8", vendor: "Acme, Inc", address: "1 Main St", amountCents: 5000, currency: "CAD", reference: `PAY-${chq}` },
  ]);
});

test("formatCents", () => {
  expect([formatCents(0), formatCents(5), formatCents(100), formatCents(12345)]).toEqual(["0.00", "0.05", "1.00", "123.45"]);
});

import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { GET as list } from "@/app/api/exceptions/route";
import { POST as resolve } from "@/app/api/exceptions/[id]/resolve/route";
import { requestBankChange, verifyBankChange } from "./vendors";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id,name,role,approval_limit_cents) VALUES
     (1,'Ann','approver',0),(2,'Emp','employee',0),(3,'Clerk','ap_clerk',0)`
  ).run();
  db.prepare("INSERT INTO vendors (id,name) VALUES (1,'Acme')").run();
  db.prepare(
    `INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,total_cents,currency,flags) VALUES
     (1,'needs_review',1,'INV-1','2026-01-01',100,'CAD','[{"code":"duplicate","message":"Same vendor and number as #9"}]'),
     (2,'needs_review',1,'INV-2','2026-01-01',200,'CAD','["bad_tax"]'),
     (3,'pending_approval',1,'INV-3','2026-01-01',300,'CAD','[]')`
  ).run();
});

const req = (user: number, init?: RequestInit) =>
  new Request("http://x", { ...init, headers: { cookie: `session=${signSession(user)}` } });
const get = (user: number) => list(req(user));
const post = (user: number, id: number, body: unknown) =>
  resolve(req(user, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) });
const audit = () =>
  getDb().prepare("SELECT * FROM audit_log WHERE action = 'exception.resolve'").all() as { after: string; actor_id: number }[];

test("employee and approver get 403 on both routes", async () => {
  for (const u of [1, 2]) {
    expect((await get(u)).status).toBe(403);
    expect((await post(u, 1, { action: "reject", note: "x" })).status).toBe(403);
  }
});

test("list has only needs_review invoices with flags", async () => {
  const body = await (await get(3)).json();
  expect(body.map((i: { id: number }) => i.id)).toEqual([1, 2]);
  expect(body[0].flags).toEqual([{ code: "duplicate", message: "Same vendor and number as #9" }]);
  expect(body[1].flags).toEqual([{ code: "bad_tax", message: "bad_tax" }]);
});

test.each([
  ["send_to_approval", "pending_approval"],
  ["reject", "rejected"],
])("%s changes status and audits the note", async (action, status) => {
  const res = await post(3, 1, { action, note: "checked with vendor" });
  expect(res.status).toBe(200);
  expect((getDb().prepare("SELECT status FROM invoices WHERE id=1").get() as { status: string }).status).toBe(status);
  const rows = audit();
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0].after).note).toBe("checked with vendor");
  expect(rows[0].actor_id).toBe(3);
});

test("non-needs_review invoice gets 409, resolving twice gets 409", async () => {
  expect((await post(3, 3, { action: "reject", note: "x" })).status).toBe(409);
  await post(3, 1, { action: "reject", note: "x" });
  expect((await post(3, 1, { action: "reject", note: "x" })).status).toBe(409);
});

test("bad body gets 400, unknown invoice 404", async () => {
  expect((await post(3, 1, { action: "nope", note: "x" })).status).toBe(400);
  expect((await post(3, 1, { action: "reject" })).status).toBe(400);
  expect((await post(3, 99, { action: "reject", note: "x" })).status).toBe(404);
});

// T44: an invoice that shows another account is held until a finance user verifies the bank change (the existing workflow).
test("bank_details_differ: send_to_approval is refused until a verified bank change makes the account match", async () => {
  const db = getDb();
  db.prepare("INSERT INTO users (id,name,role,approval_limit_cents) VALUES (4,'Fin','finance_manager',0)").run();
  db.prepare("UPDATE vendors SET bank_institution='001', bank_transit='12345', bank_account='123456789' WHERE id=1").run();
  const shown = { bankDetails: null, bankInstitution: "001", bankTransit: "12345", bankAccount: "777777777" };
  db.prepare("UPDATE invoices SET flags = ?, extraction_json = ? WHERE id = 1").run('[{"code":"bank_details_differ","message":"x","severity":"error"}]', JSON.stringify(shown));

  const refused = await post(3, 1, { action: "send_to_approval", note: "looks fine" });
  expect(refused.status).toBe(409);
  expect((db.prepare("SELECT status FROM invoices WHERE id=1").get() as { status: string }).status).toBe("needs_review");

  requestBankChange({ id: 3, name: "Clerk", role: "ap_clerk" } as never, 1, { institution: "001", transit: "12345", account: "777777777", channel: "phone" });
  verifyBankChange({ id: 4, name: "Fin", role: "finance_manager" } as never, 1, true);
  expect((await post(3, 1, { action: "send_to_approval", note: "bank change verified" })).status).toBe(200);
});

test("bank_details_differ: rejecting is always allowed, and an unreadable invoice record stays blocked", async () => {
  const db = getDb();
  db.prepare("UPDATE invoices SET flags = ?, extraction_json = 'not json' WHERE id IN (1,2)").run('[{"code":"bank_details_differ","message":"x"}]');
  expect((await post(3, 1, { action: "send_to_approval", note: "x" })).status).toBe(409);
  expect((await post(3, 2, { action: "reject", note: "x" })).status).toBe(200);
});

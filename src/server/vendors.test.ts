import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { GET as list } from "@/app/api/vendors/route";
import { GET as one, PATCH as patch } from "@/app/api/vendors/[id]/route";
import { POST as request } from "@/app/api/vendors/[id]/bank-change/route";
import { POST as verify } from "@/app/api/vendors/[id]/bank-change/verify/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const CLERK = 1, FIN = 2, CTRL = 3, AUD = 4, EMP = 5, FIN2 = 6;
beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id,name,role,approval_limit_cents) VALUES
     (1,'Clerk','ap_clerk',0),(2,'Fin','finance_manager',0),(3,'Ctrl','controller_admin',0),(4,'Aud','auditor',0),(5,'Emp','employee',0),(6,'Fin2','finance_manager',0)`
  ).run();
  db.prepare("INSERT INTO vendors (id,name,bank_institution,bank_transit,bank_account) VALUES (1,'Acme','001','11111','12345678')").run();
});

const ctx = (id = 1) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (user: number, body?: unknown, method = "POST") =>
  new Request("http://x", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie: `session=${signSession(user)}` } });
const NEW = { institution: "002", transit: "22222", account: "99990000", channel: "email_request" };
const vendor = () => getDb().prepare("SELECT bank_account, bank_transit FROM vendors WHERE id=1").get();
const audits = (action: string) => (getDb().prepare("SELECT COUNT(*) n FROM audit_log WHERE action=?").get(action) as { n: number }).n;

test("read roles: auditor ok, employee 403, last4 only", async () => {
  expect((await list(req(EMP, undefined, "GET"))).status).toBe(403);
  const res = await one(req(AUD, undefined, "GET"), ctx());
  expect(res.status).toBe(200);
  const v = await res.json();
  expect(v.bank_account_last4).toBe("5678");
  expect(v.bank_account).toBeUndefined();
});

test("patch: clerk edits non-bank fields (audited); auditor 403; bank fields 400", async () => {
  expect((await patch(req(AUD, { category: "x" }, "PATCH"), ctx())).status).toBe(403);
  expect((await patch(req(CLERK, { bank_account: "1" }, "PATCH"), ctx())).status).toBe(400);
  expect((await patch(req(CLERK, { category: "Fuel" }, "PATCH"), ctx())).status).toBe(200);
  expect(audits("vendor.update")).toBe(1);
});

test("clerk can request but not verify; master unchanged; request row has last4s", async () => {
  const res = await request(req(CLERK, NEW), ctx());
  expect(res.status).toBe(201);
  expect((await verify(req(CLERK, { verified: true }), ctx())).status).toBe(403);
  expect(vendor()).toEqual({ bank_account: "12345678", bank_transit: "11111" });
  expect(getDb().prepare("SELECT status, old_account_last4 o, new_account_last4 n, request_channel c FROM vendor_bank_changes").get()).toEqual({ status: "pending", o: "5678", n: "0000", c: "email_request" });
  expect(audits("vendor.bank_change_requested")).toBe(1);
});

test("requester cannot verify own request even with a verifier role", async () => {
  await request(req(FIN, NEW), ctx());
  const res = await verify(req(FIN, { verified: true }), ctx());
  expect(res.status).toBe(403);
  expect(vendor()).toEqual({ bank_account: "12345678", bank_transit: "11111" });
});

test("a different finance_manager verifies: master changes only now; audit rows exist", async () => {
  await request(req(CLERK, NEW), ctx());
  expect(vendor()).toEqual({ bank_account: "12345678", bank_transit: "11111" });
  expect((await verify(req(FIN2, { verified: true }), ctx())).status).toBe(200);
  expect(vendor()).toEqual({ bank_account: "99990000", bank_transit: "22222" });
  expect(getDb().prepare("SELECT status, verified_by_callback v, verified_by_user_id u FROM vendor_bank_changes").get()).toEqual({ status: "applied", v: 1, u: FIN2 });
  expect(audits("vendor.bank_change_verified")).toBe(1);
  expect(audits("vendor.bank_updated")).toBe(1);
  expect((await verify(req(CTRL, { verified: true }), ctx())).status).toBe(409); // nothing pending any more: already decided, so 409 (T57)
});

test("verified=false rejects and leaves the master alone; bad inputs 400; second pending 409", async () => {
  expect((await request(req(CLERK, { ...NEW, account: "12" }), ctx())).status).toBe(400);
  await request(req(CLERK, NEW), ctx());
  expect((await request(req(CLERK, NEW), ctx())).status).toBe(409);
  expect((await verify(req(CTRL, { verified: "yes" }), ctx())).status).toBe(400);
  expect((await verify(req(CTRL, { verified: false }), ctx())).status).toBe(200);
  expect(vendor()).toEqual({ bank_account: "12345678", bank_transit: "11111" });
  expect(audits("vendor.bank_change_rejected")).toBe(1);
});

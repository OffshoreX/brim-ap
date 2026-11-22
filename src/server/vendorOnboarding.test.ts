import { beforeEach, describe, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { POST as create } from "@/app/api/vendors/route";
import { PATCH as patch } from "@/app/api/vendors/[id]/route";
import { POST as approve } from "@/app/api/vendors/[id]/approve/route";
import { POST as hold } from "@/app/api/vendors/[id]/hold/route";
import { POST as release } from "@/app/api/vendors/[id]/release-hold/route";
import { matchVendor } from "./rules/vendorMatch";
import { verifyAuditChain } from "./audit";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const CLERK = 1, FIN = 2, CTRL = 3, AUD = 4, EMP = 5, FIN2 = 6, APPR = 7;
beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id,name,role,approval_limit_cents) VALUES
     (1,'Clerk','ap_clerk',0),(2,'Fin','finance_manager',0),(3,'Ctrl','controller_admin',0),(4,'Aud','auditor',0),(5,'Emp','employee',0),(6,'Fin2','finance_manager',0),(7,'Appr','approver',0)`
  ).run();
  db.prepare("INSERT INTO gl_accounts (id, code, name) VALUES (5010, '5010', 'Freight')").run();
  db.prepare("INSERT INTO vendors (id,name,status) VALUES (1,'Polar Freight Lines Ltd.','active')").run();
});

const ctx = (id = 1) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (user: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie: `session=${signSession(user)}`, ...headers } });
const GOOD = { name: "  Northern Lights Supply Inc.  ", category: "Supplies", province_or_state: "QC", country: "ca", gst_hst_number: "123456789 rt0001", qst_number: "1234567890TQ0001", payment_terms_days: 30, preferred_payment_method: "EFT", ap_contact_email: "ap@northern.example", requires_po: true, default_gl_account: "5010" };
const row = (id: number) => getDb().prepare("SELECT * FROM vendors WHERE id = ?").get(id) as Record<string, unknown>;
const audits = (action: string) => getDb().prepare("SELECT * FROM audit_log WHERE action = ?").all(action) as { actor_id: number; entity_id: string; before: string | null; after: string }[];
const made = async (user = CLERK) => ((await (await create(req(user, GOOD))).json()) as { id: number }).id;

describe("create", () => {
  test("clerk, finance and controller may create; others get 403", async () => {
    for (const [u, status] of [[CLERK, 201], [FIN, 201], [CTRL, 201], [AUD, 403], [EMP, 403], [APPR, 403]] as const)
      expect((await create(req(u, { name: `Vendor ${u} Works` }))).status).toBe(status);
  });

  test("new vendor is pending_review, trimmed and normalised, with no bank details, and the creator is audited", async () => {
    const res = await create(req(CLERK, GOOD));
    expect(res.status).toBe(201);
    const v = row(((await res.json()) as { id: number }).id);
    expect(v).toMatchObject({ name: "Northern Lights Supply Inc.", status: "pending_review", country: "CA", gst_hst_number: "123456789RT0001", requires_po: 1, default_gl_account: "5010", created_by_user_id: CLERK });
    expect(v.onboarded_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect([v.bank_institution, v.bank_transit, v.bank_account]).toEqual([null, null, null]);
    const [a] = audits("vendor.create");
    expect(a).toMatchObject({ actor_id: CLERK, entity_id: String(v.id) });
    expect(JSON.parse(a.after)).toMatchObject({ name: "Northern Lights Supply Inc.", status: "pending_review" });
    expect(verifyAuditChain().ok).toBe(true);
  });

  test("bank fields, status and unknown fields are refused and nothing is saved", async () => {
    for (const extra of [{ bank_account: "1" }, { bank_institution: "001" }, { bank_transit: "1" }, { status: "active" }, { bankAccount: "1" }, { id: 9 }]) {
      const res = await create(req(CLERK, { ...GOOD, ...extra }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(Object.keys(extra)[0]);
    }
    expect(getDb().prepare("SELECT COUNT(*) n FROM vendors").get()).toEqual({ n: 1 });
  });

  test.each([
    [{ name: "   " }, "name is required"],
    [{ name: "!!!" }, "name is required"],
    [{ name: 5 }, "name"],
    [{ payment_terms_days: -1 }, "payment_terms_days"],
    [{ payment_terms_days: 30.5 }, "payment_terms_days"],
    [{ payment_terms_days: "30" }, "payment_terms_days"],
    [{ preferred_payment_method: "WIRE" }, "EFT, CHEQUE or CARD"],
    [{ ap_contact_email: "nope" }, "email"],
    [{ requires_po: "yes" }, "true or false"],
    [{ country: "Canada" }, "CA or US"],
    [{ gst_hst_number: "12345" }, "gst_hst_number"],
    [{ qst_number: "12345" }, "qst_number"],
    [{ default_gl_account: "9999" }, "not a known GL account"],
  ])("invalid field %j -> 400 mentioning %s", async (bad, word) => {
    const res = await create(req(CLERK, { ...GOOD, ...bad }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(word);
  });

  test("a body that is not an object is a 400", async () => {
    expect((await create(req(CLERK, [1]))).status).toBe(400);
    expect((await create(new Request("http://x", { method: "POST", body: "{", headers: { cookie: `session=${signSession(CLERK)}` } }))).status).toBe(400);
  });

  test("only the name is required", async () => {
    const res = await create(req(CLERK, { name: "Bare Minimum Co" }));
    expect(res.status).toBe(201);
    expect(row(((await res.json()) as { id: number }).id)).toMatchObject({ requires_po: 0, payment_terms_days: null, status: "pending_review" });
  });

  test("a duplicate or near-duplicate name is refused with 409 naming the existing vendor", async () => {
    for (const name of ["Polar Freight Lines Ltd.", "polar freight lines ltd", "  POLAR FREIGHT LINES LIMITED ", "Polar Freight Lines", "Pôlar Freight Lines, Ltée"]) {
      const res = await create(req(CLERK, { name }));
      expect(res.status, name).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain('"Polar Freight Lines Ltd."');
    }
    expect(await made()).toBeGreaterThan(1);
    expect((await create(req(CLERK, GOOD))).status).toBe(409); // the vendor we just made counts too
  });

  test("a created name is always unambiguous for the invoice matcher", async () => {
    const id = await made();
    const m = matchVendor("Northern Lights Supply Inc", getDb().prepare("SELECT id, name FROM vendors").all() as { id: number; name: string }[]);
    expect(m).toMatchObject({ status: "matched", id });
  });

  test("the same Idempotency-Key replays the first response; a different body with that key is a 409", async () => {
    const a = await (await create(req(CLERK, GOOD, { "idempotency-key": "k1" }))).json();
    const b = await (await create(req(CLERK, GOOD, { "idempotency-key": "k1" }))).json();
    expect(b).toEqual(a);
    expect(getDb().prepare("SELECT COUNT(*) n FROM vendors").get()).toEqual({ n: 2 });
    expect(audits("vendor.create")).toHaveLength(1);
    expect((await create(req(CLERK, { name: "Other Co" }, { "idempotency-key": "k1" }))).status).toBe(409);
  });

  test("a clerk cannot sidestep approval by patching status", async () => {
    const id = await made();
    const res = await patch(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "active" }), headers: { cookie: `session=${signSession(CLERK)}` } }), ctx(id));
    expect(res.status).toBe(400);
    expect(row(id).status).toBe("pending_review");
  });
});

describe("approve", () => {
  test("only finance_manager and controller_admin; clerk, auditor, employee and approver get 403", async () => {
    const id = await made(FIN2);
    for (const u of [CLERK, AUD, EMP, APPR]) expect((await approve(req(u), ctx(id))).status).toBe(403);
    expect(row(id).status).toBe("pending_review");
    expect((await approve(req(CTRL), ctx(id))).status).toBe(200);
  });

  test("the creator cannot approve, even as finance_manager; another finance user can; audit has before and after", async () => {
    const id = await made(FIN);
    const res = await approve(req(FIN), ctx(id));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("someone else must approve");
    expect(row(id).status).toBe("pending_review");
    expect((await approve(req(FIN2), ctx(id))).status).toBe(200);
    expect(row(id).status).toBe("active");
    const [a] = audits("vendor.approve");
    expect(a).toMatchObject({ actor_id: FIN2, entity_id: String(id) });
    expect([JSON.parse(a.before!), JSON.parse(a.after)]).toEqual([{ status: "pending_review" }, { status: "active" }]);
  });

  test("an approved or unknown vendor is refused; a repeat leaves one audit row; the key replays", async () => {
    const id = await made(CLERK);
    expect((await approve(req(FIN, undefined, { "idempotency-key": "a1" }), ctx(id))).status).toBe(200);
    expect((await approve(req(FIN, undefined, { "idempotency-key": "a1" }), ctx(id))).status).toBe(200); // replay
    expect((await approve(req(FIN2), ctx(id))).status).toBe(409);
    expect((await approve(req(FIN), ctx(999))).status).toBe(404);
    expect((await approve(req(FIN), { params: Promise.resolve({ id: "x" }) })).status).toBe(400);
    expect(audits("vendor.approve")).toHaveLength(1);
  });
});

describe("hold and release-hold", () => {
  test("hold needs finance/controller and a reason; audit row carries the reason", async () => {
    for (const u of [CLERK, AUD, EMP, APPR]) expect((await hold(req(u, { reason: "x" }), ctx())).status).toBe(403);
    for (const bad of [undefined, {}, { reason: "  " }, { reason: 5 }, { reason: "x".repeat(501) }]) expect((await hold(req(FIN, bad), ctx())).status).toBe(400);
    expect(row(1).status).toBe("active");
    const res = await hold(req(FIN, { reason: " Bank letter looks forged " }), ctx());
    expect(res.status).toBe(200);
    expect(row(1).status).toBe("on_hold");
    const [a] = audits("vendor.hold");
    expect(a.actor_id).toBe(FIN);
    expect([JSON.parse(a.before!), JSON.parse(a.after)]).toEqual([{ status: "active" }, { status: "on_hold", reason: "Bank letter looks forged" }]);
  });

  test("release-hold needs finance/controller, only works on a held vendor, and is audited", async () => {
    expect((await release(req(FIN), ctx())).status).toBe(409); // active already
    await hold(req(FIN, { reason: "r" }), ctx());
    for (const u of [CLERK, AUD, EMP, APPR]) expect((await release(req(u), ctx())).status).toBe(403);
    expect((await release(req(CTRL), ctx())).status).toBe(200);
    expect(row(1).status).toBe("active");
    const [a] = audits("vendor.release_hold");
    expect([a.actor_id, JSON.parse(a.before!), JSON.parse(a.after)]).toEqual([CTRL, { status: "on_hold" }, { status: "active" }]);
  });

  test("a pending vendor cannot be held (releasing it would skip approval); a held vendor cannot be approved", async () => {
    const id = await made();
    expect((await hold(req(FIN, { reason: "r" }), ctx(id))).status).toBe(409);
    await hold(req(FIN, { reason: "r" }), ctx());
    expect((await approve(req(FIN), ctx())).status).toBe(409);
  });

  test("hold and release replay with the same Idempotency-Key and write one audit row each", async () => {
    for (let i = 0; i < 2; i++) expect((await hold(req(FIN, { reason: "r" }, { "idempotency-key": "h" }), ctx())).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await release(req(FIN, undefined, { "idempotency-key": "r" }), ctx())).status).toBe(200);
    expect([audits("vendor.hold").length, audits("vendor.release_hold").length]).toEqual([1, 1]);
    expect(verifyAuditChain().ok).toBe(true);
  });
});

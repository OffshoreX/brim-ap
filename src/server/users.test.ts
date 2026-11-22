import { beforeEach, describe, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { verifyAuditChain } from "./audit";
import { GET as list } from "@/app/api/users/route";
import { PATCH } from "@/app/api/users/[id]/route";
import { GET as me } from "@/app/api/me/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";
delete process.env.DEMO_PERSONA_PICKER;

const CTRL = 1, CTRL2 = 2, APPR = 3, EMP = 4, FIN = 5, AUD = 6, CLERK = 7;
beforeEach(() => {
  resetDbForTests();
  getDb().prepare(
    `INSERT INTO users (id,name,role,manager_id,approval_limit_cents,email) VALUES
     (1,'Ctrl','controller_admin',NULL,0,'c@x'),(2,'Ctrl2','controller_admin',NULL,0,'c2@x'),(3,'Appr','approver',NULL,500000,'a@x'),
     (4,'Emp','employee',3,0,'e@x'),(5,'Fin','finance_manager',NULL,0,'f@x'),(6,'Aud','auditor',NULL,0,'au@x'),(7,'Clerk','ap_clerk',NULL,0,'cl@x')`
  ).run();
});

const as = (user: number) => ({ cookie: `session=${signSession(user)}` });
const patch = async (actor: number, id: number, body: unknown) => {
  const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body), headers: as(actor) }), { params: Promise.resolve({ id: String(id) }) });
  return { status: res.status, body: await res.json() };
};
const row = (id: number) => getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown>;
const audits = () => getDb().prepare("SELECT actor_id, action, entity_id, before, after FROM audit_log WHERE action = 'user.update'").all() as { actor_id: number; entity_id: string; before: string; after: string }[];

describe("changes", () => {
  test("changes role, manager, limit and status in one call, and returns the new user", async () => {
    const r = await patch(CTRL, EMP, { role: "approver", manager_id: FIN, approval_limit_cents: 250000, status: "terminated" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: EMP, role: "approver", managerId: FIN, approvalLimitCents: 250000, status: "terminated" });
    expect(row(EMP)).toMatchObject({ role: "approver", manager_id: FIN, approval_limit_cents: 250000, status: "terminated" });
  });

  test("on leave with an active approver as delegate works", async () => {
    const r = await patch(CTRL, FIN, { status: "on_leave", delegate_user_id: APPR });
    expect(r.status).toBe(200);
    expect(row(FIN)).toMatchObject({ status: "on_leave", delegate_user_id: APPR });
  });

  test("writes one audit row with who, and before and after of only the changed fields", async () => {
    await patch(CTRL, APPR, { approval_limit_cents: 900000, role: "approver" }); // role is unchanged, so it is not logged
    const [a, ...rest] = audits();
    expect(rest).toEqual([]);
    expect(a).toMatchObject({ actor_id: CTRL, entity_id: String(APPR) });
    expect(JSON.parse(a.before)).toEqual({ approval_limit_cents: 500000 });
    expect(JSON.parse(a.after)).toEqual({ approval_limit_cents: 900000 });
    expect(verifyAuditChain().ok).toBe(true);
  });

  test("a rejected change writes no audit row and changes nothing", async () => {
    await patch(CTRL, EMP, { role: "wizard" });
    expect(audits()).toEqual([]);
    expect(row(EMP).role).toBe("employee");
  });
});

describe("validation (plain 400 messages)", () => {
  test.each([
    [{}, "Nothing to update"],
    [{ name: "X" }, "Not editable here: name"],
    [{ role: "wizard" }, "role must be one of"],
    [{ status: "gone" }, "status must be one of"],
    [{ approval_limit_cents: 12.5 }, "whole number of cents"],
    [{ approval_limit_cents: -1 }, "whole number of cents"],
    [{ manager_id: 999 }, "existing user"],
    [{ delegate_user_id: "3" }, "existing user"],
    [{ delegate_user_id: EMP }, "not an approver or above"],
    [{ delegate_user_id: AUD }, "not an approver or above"],
    [{ status: "on_leave" }, "needs a delegate"],
  ])("%j -> 400", async (body, message) => {
    const r = await patch(CTRL, FIN, body);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain(message);
  });

  test("unknown user is 404, bad id is 400", async () => {
    expect((await patch(CTRL, 999, { role: "employee" })).status).toBe(404);
    expect((await patch(CTRL, Number.NaN, { role: "employee" })).status).toBe(400);
  });

  test("manager must be active", async () => {
    getDb().prepare("UPDATE users SET status='terminated' WHERE id = ?").run(FIN);
    const r = await patch(CTRL, EMP, { manager_id: FIN });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("cannot be a manager");
  });

  test("delegate must be active, and not the user themself", async () => {
    getDb().prepare("UPDATE users SET status='terminated' WHERE id = ?").run(APPR);
    expect((await patch(CTRL, FIN, { delegate_user_id: APPR })).body.error).toContain("cannot be a delegate");
    expect((await patch(CTRL, FIN, { delegate_user_id: FIN })).body.error).toContain("own delegate");
  });

  test("manager loops are refused, direct and through a chain", async () => {
    expect((await patch(CTRL, EMP, { manager_id: EMP })).body.error).toContain("loop");
    getDb().prepare("UPDATE users SET manager_id = ? WHERE id = ?").run(EMP, FIN); // Fin -> Emp -> Appr
    const r = await patch(CTRL, APPR, { manager_id: FIN }); // Appr -> Fin would close the circle
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("loop");
  });
});

describe("guards", () => {
  test("nobody can change any field of their own record (403, Ask another controller); another controller can", async () => {
    for (const body of [{ role: "employee" }, { status: "terminated" }, { approval_limit_cents: 100 }, { manager_id: null }, {}]) {
      const r = await patch(CTRL, CTRL, body);
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("Ask another controller");
    }
    expect(row(CTRL)).toMatchObject({ role: "controller_admin", status: "active", approval_limit_cents: 0 });
    expect(audits()).toHaveLength(0);
    expect((await patch(CTRL2, CTRL, { approval_limit_cents: 100 })).status).toBe(200);
  });

  test("the last active controller cannot be demoted or terminated by anyone", async () => {
    getDb().prepare("UPDATE users SET status='on_leave' WHERE id = ?").run(CTRL); // Ctrl can still act, but is no longer "active"
    for (const body of [{ role: "employee" }, { status: "terminated" }]) {
      const r = await patch(CTRL, CTRL2, body);
      expect(r.status).toBe(409);
      expect(r.body.error).toContain("last active controller");
    }
    expect(row(CTRL2)).toMatchObject({ role: "controller_admin", status: "active" });
  });

  test("with a second active controller, a controller can be demoted", async () => {
    expect((await patch(CTRL, CTRL2, { role: "auditor" })).status).toBe(200);
  });

  test("terminating a manager or a delegate is a 409 that names who is affected", async () => {
    const mgr = await patch(CTRL, APPR, { status: "terminated" }); // Emp reports to Appr
    expect(mgr.status).toBe(409);
    expect(mgr.body.error).toContain("manager of: Emp");
    getDb().prepare("UPDATE users SET manager_id = NULL WHERE id = ?").run(EMP);
    getDb().prepare("UPDATE users SET status='on_leave', delegate_user_id = ? WHERE id = ?").run(APPR, FIN);
    const del = await patch(CTRL, APPR, { status: "terminated" });
    expect(del.status).toBe(409);
    expect(del.body.error).toContain("delegate for: Fin");
    expect(row(APPR).status).toBe("active");
  });

  test("terminating someone nobody depends on works", async () => {
    expect((await patch(CTRL, CLERK, { status: "terminated" })).status).toBe(200);
  });
});

describe("who may call", () => {
  test("every other role gets 403 and nothing changes", async () => {
    for (const actor of [APPR, EMP, FIN, AUD, CLERK]) expect((await patch(actor, EMP, { role: "approver" })).status).toBe(403);
    expect(row(EMP).role).toBe("employee");
  });
  test("no session is 401", async () => {
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ id: "4" }) });
    expect(res.status).toBe(401);
  });
});

describe("sessions follow the database", () => {
  const meAs = (user: number) => me(new Request("http://x/api/me", { headers: as(user) }));
  test("a terminated user's existing cookie stops working on the next request", async () => {
    expect((await meAs(CLERK)).status).toBe(200);
    expect((await patch(CTRL, CLERK, { status: "terminated" })).status).toBe(200);
    expect((await meAs(CLERK)).status).toBe(401);
  });
  test("a demoted controller loses controller access on the next request", async () => {
    expect((await patch(CTRL, CLERK, { role: "employee" })).status).toBe(200);
    expect((await patch(CLERK, EMP, { role: "approver" })).status).toBe(403);
  });
});

describe("GET /api/users", () => {
  const get = async (user?: number) => {
    const res = await list(new Request("http://x/api/users", { headers: user ? as(user) : {} }));
    return { status: res.status, body: await res.json() };
  };
  test("controller and auditor get email, title, status, manager, limit and delegate; never the password hash", async () => {
    for (const who of [CTRL, AUD]) {
      const { status, body } = await get(who);
      expect(status).toBe(200);
      expect(body.users).toHaveLength(7);
      expect(body.users.find((u: { id: number }) => u.id === EMP)).toEqual({
        id: EMP, name: "Emp", email: "e@x", title: null, role: "employee", status: "active", managerId: APPR, approvalLimitCents: 0, delegateUserId: null,
      });
      expect(JSON.stringify(body)).not.toContain("password");
    }
  });
  test("other roles and anonymous callers keep today's behaviour: 404 with the picker off, id/name/role only with it on", async () => {
    for (const who of [undefined, APPR, EMP, CLERK, FIN]) expect((await get(who)).status).toBe(404);
    process.env.DEMO_PERSONA_PICKER = "1";
    try {
      const { status, body } = await get(EMP);
      expect(status).toBe(200);
      expect(Object.keys(body.users[0]).sort()).toEqual(["id", "name", "role"]);
    } finally {
      delete process.env.DEMO_PERSONA_PICKER;
    }
  });
});

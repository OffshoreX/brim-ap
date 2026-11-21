import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { GET as invoices } from "@/app/api/invoices/route";
import { GET as audit } from "@/app/api/audit/route";
import { GET as exceptions } from "@/app/api/exceptions/route";
import { GET as payments } from "@/app/api/payments/route";
import { GET as other } from "@/app/api/inbox/other/route";
import { GET as inbox } from "@/app/api/approvals/inbox/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// 260 needs_review invoices for vendor 1, a controller (user 1) to read them.
beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.exec("INSERT INTO users (id,name,role) VALUES (1,'Admin','controller_admin'); INSERT INTO vendors (id,name) VALUES (1,'Acme');");
  const inv = db.prepare("INSERT INTO invoices (status,vendor_id,invoice_number,invoice_date,total_cents,currency) VALUES ('needs_review',1,?,'2026-11-01',100,'CAD')");
  const mail = db.prepare("INSERT INTO inbox_mail (email_id,from_address,subject,class) VALUES (?,'a@b.c','s','marketing')");
  const pay = db.prepare("INSERT INTO payments (invoice_id,vendor_id,status,amount_cents,currency) VALUES (?,1,'scheduled',100,'CAD')");
  for (let i = 1; i <= 260; i++) { inv.run(`N-${i}`); mail.run(`E${i}`); pay.run(i); }
});

const get = (route: (r: Request) => Promise<Response>, q = "") =>
  route(new Request("http://x/" + q, { headers: { cookie: `session=${signSession(1)}` } }));

test("every list endpoint: default 50, cap 200, offset, total in X-Total-Count", async () => {
  for (const route of [invoices, exceptions, payments, other, audit]) {
    if (route === audit) getDb().prepare("INSERT INTO audit_log (actor_id,action,entity,entity_id) VALUES (1,'x','invoice','1')").run();
    const total = route === audit ? 1 : 260;
    const def = await get(route);
    expect(def.headers.get("X-Total-Count")).toBe(String(total));
    expect(await def.json()).toHaveLength(Math.min(50, total));
    if (route === audit) continue;
    expect(await (await get(route, "?limit=1000")).json()).toHaveLength(200); // capped, not rejected
    expect(await (await get(route, "?limit=100&offset=200")).json()).toHaveLength(60); // last partial page
    expect((await get(route, "?limit=0")).status).toBe(400);
    expect((await get(route, "?offset=-1")).status).toBe(400);
    expect((await get(route, "?limit=abc")).status).toBe(400);
  }
});

test("pages do not overlap and cover every row once", async () => {
  const ids: number[] = [];
  for (let off = 0; off < 260; off += 100) ids.push(...(await (await get(invoices, `?limit=100&offset=${off}`)).json()).map((r: { id: number }) => r.id));
  expect(new Set(ids).size).toBe(260);
});

test("approval inbox is paged and counted too", async () => {
  const res = await get(inbox);
  expect(res.headers.get("X-Total-Count")).toBe("0");
  expect(await res.json()).toEqual([]);
});

// The real hot queries must be answered from an index, never a full table scan of the big tables.
const plan = (sql: string, ...args: unknown[]) =>
  (getDb().prepare("EXPLAIN QUERY PLAN " + sql).all(...args) as { detail: string }[]).map((r) => r.detail).join(" | ");

test("hot queries use an index (EXPLAIN QUERY PLAN)", () => {
  const cases: [string, string, unknown[]][] = [
    ["duplicate lookup by vendor and number", "SELECT id FROM invoices WHERE vendor_id = ? AND invoice_number = ? AND id != ?", [1, "N-1", 0]],
    ["duplicate scan by vendor (pipeline)", "SELECT id, invoice_number, total_cents, invoice_date FROM invoices WHERE vendor_id = ? AND id != ? AND invoice_number != ''", [1, 0]],
    ["invoices by status", "SELECT id FROM invoices WHERE status = 'needs_review' ORDER BY id LIMIT 50", []],
    ["invoices by date", "SELECT id FROM invoices WHERE invoice_date >= '2026-01-01'", []],
    ["invoices by total", "SELECT id FROM invoices WHERE total_cents > 100000", []],
    ["employee list", "SELECT id FROM invoices WHERE requester_id = 1 ORDER BY id LIMIT 50", []],
    ["dashboard due this week", "SELECT SUM(total_cents) FROM invoices WHERE status NOT IN ('paid','rejected') AND due_date >= '2026-11-01' AND due_date <= '2026-11-07'", []],
    ["approvals by invoice", "SELECT id FROM approvals WHERE invoice_id = 1", []],
    ["approvals by approver", "SELECT id FROM approvals WHERE approver_id = 1", []],
    ["audit by entity and id", "SELECT id FROM audit_log WHERE entity = 'invoice' AND entity_id = '1' ORDER BY at, id", []],
    ["audit newest page", "SELECT id FROM audit_log ORDER BY at DESC, id DESC LIMIT 50", []],
    ["audit by entity newest", "SELECT id FROM audit_log WHERE entity = 'invoice' ORDER BY at DESC, id DESC LIMIT 50", []],
    ["payments by status and date", "SELECT id FROM payments WHERE status = 'scheduled' AND scheduled_date <= '2026-12-01'", []],
    ["payments of an invoice", "SELECT id FROM payments WHERE invoice_id = 1", []],
    ["approver inbox", "SELECT invoice_id FROM approval_steps WHERE user_id = 1 AND status = 'pending'", []],
  ];
  for (const [name, sql, args] of cases) {
    const p = plan(sql, ...args);
    expect(p, `${name}: ${p}`).toMatch(/USING (COVERING )?INDEX/);
    expect(p, `${name}: ${p}`).not.toMatch(/SCAN invoices(?! USING)|SCAN audit_log(?! USING)|SCAN payments(?! USING)|SCAN approvals(?! USING)/);
  }
});

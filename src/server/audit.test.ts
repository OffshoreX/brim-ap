import { beforeEach, expect, test } from "vitest";
import Database from "better-sqlite3";
import { verifyAuditChain, writeAudit } from "./audit";
import { applySchema, getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { importDataset } from "./importDataset";
import { GET as auditRoute } from "@/app/api/audit/route";
import { GET as verifyRoute } from "@/app/api/audit/verify/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const ROLES = ["employee", "ap_clerk", "finance_manager", "controller_admin", "auditor"]; // user id = index + 1
const ID = Object.fromEntries(ROLES.map((r, i) => [r, i + 1]));

beforeEach(() => {
  resetDbForTests();
  const ins = getDb().prepare("INSERT INTO users (id, name, role) VALUES (?,?,?)");
  ROLES.forEach((r, i) => ins.run(i + 1, r, r));
});

const log = (n: number, entity = "invoice") => {
  for (let i = 0; i < n; i++) writeAudit({ actorId: 2, action: "invoice.status", entity, entityId: i, before: { s: "a" }, after: { s: "b" } });
};
// The append-only triggers are what stops edits in normal use. Only someone who can alter the schema can get past them.
const dropTriggers = () => getDb().exec("DROP TRIGGER audit_log_no_update; DROP TRIGGER audit_log_no_delete");

test("an empty log verifies, and the chain holds after normal writes, a transaction and the dataset import", () => {
  expect(verifyAuditChain()).toEqual({ ok: true, rowCount: 0, headHash: "" });
  log(5);
  writeAudit({ actorId: null, action: "login", entity: "user", entityId: 1 }); // no before/after
  getDb().transaction(() => log(3, "payment"))(); // appendAudit inside an outer transaction
  expect(verifyAuditChain()).toMatchObject({ ok: true, rowCount: 9 });
  importDataset(getDb());
  expect(verifyAuditChain()).toMatchObject({ ok: true, rowCount: 10 });
});

test("a rolled-back transaction leaves no gap in the chain", () => {
  log(2);
  expect(() => getDb().transaction(() => { log(1); throw new Error("boom"); })()).toThrow("boom");
  log(1);
  expect(verifyAuditChain()).toMatchObject({ ok: true, rowCount: 3 });
});

test.each(["actor_id", "action", "entity", "entity_id", "at", "before", "after"])("a row edited with raw SQL (%s) is found at that row", (col) => {
  log(6);
  dropTriggers();
  getDb().prepare(`UPDATE audit_log SET ${col} = ? WHERE id = 4`).run(col === "actor_id" ? 5 : "forged");
  expect(verifyAuditChain()).toMatchObject({ ok: false, brokenAtId: 4, reason: expect.stringContaining("edited") });
});

test("a deleted row, a row with no hash, and a rewritten hash are found", () => {
  log(6);
  dropTriggers();
  const db = getDb();
  db.prepare("DELETE FROM audit_log WHERE id = 3").run();
  expect(verifyAuditChain()).toMatchObject({ ok: false, brokenAtId: 4 }); // the row after the gap no longer links back
  db.prepare("INSERT INTO audit_log (id, action, entity) VALUES (3, 'x', 'y')").run(); // refill the gap, bypassing writeAudit
  expect(verifyAuditChain()).toMatchObject({ ok: false, brokenAtId: 3, reason: expect.stringContaining("no hash") });
  db.prepare("DELETE FROM audit_log WHERE id = 3").run();
  db.prepare("UPDATE audit_log SET row_hash = 'abc' WHERE id = 2").run();
  expect(verifyAuditChain()).toMatchObject({ ok: false, brokenAtId: 2 });
});

test("the head hash changes with every row, so a copy kept elsewhere exposes deleted newest rows", () => {
  log(3);
  const before = verifyAuditChain();
  log(1);
  const after = verifyAuditChain();
  expect(before.ok && after.ok && before.headHash !== after.headHash).toBe(true);
});

// What an existing database looks like before this change: no hash columns, rows already present.
const OLD_AUDIT = `CREATE TABLE audit_log (id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, before TEXT, after TEXT);
  CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;`;

test("migration on an empty database adds the columns and verifies", () => {
  const d = new Database(":memory:");
  d.exec(OLD_AUDIT);
  applySchema(d);
  expect((d.pragma("table_info(audit_log)") as { name: string }[]).map((c) => c.name)).toEqual(expect.arrayContaining(["prev_hash", "row_hash"]));
  expect(verifyAuditChain(d)).toEqual({ ok: true, rowCount: 0, headHash: "" });
});

test("migration on a populated database chains the old rows once, keeps the triggers, and is not repeated", () => {
  const d = new Database(":memory:");
  d.exec(OLD_AUDIT);
  for (let i = 0; i < 4; i++) d.prepare("INSERT INTO audit_log (action, entity, entity_id, after) VALUES ('old', 'invoice', ?, '{}')").run(String(i));
  applySchema(d);
  expect(verifyAuditChain(d)).toMatchObject({ ok: true, rowCount: 4 });
  expect(() => d.prepare("UPDATE audit_log SET action = 'z'").run()).toThrow(/append-only/); // trigger restored
  expect(() => d.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
  // A row inserted by raw SQL after the migration must NOT be quietly chained by the next start-up.
  d.prepare("INSERT INTO audit_log (action, entity) VALUES ('sneaky', 'x')").run();
  applySchema(d);
  expect(verifyAuditChain(d)).toMatchObject({ ok: false, brokenAtId: 5 });
});

// ---- routes ----
const get = (route: typeof auditRoute, user: number | null, query = "") =>
  route(new Request(`http://x/api/audit${query}`, { headers: user ? { cookie: `session=${signSession(user)}` } : {} }));

test("verify route: auditor and controller_admin only; reports the first broken row", async () => {
  log(4);
  const ok = await (await get(verifyRoute, ID.auditor)).json();
  expect(ok).toMatchObject({ ok: true, rowCount: 4 });
  expect((await get(verifyRoute, ID.controller_admin)).status).toBe(200);
  for (const r of ["employee", "ap_clerk", "finance_manager"]) expect((await get(verifyRoute, ID[r])).status).toBe(403);
  expect((await get(verifyRoute, null)).status).toBe(401);
  dropTriggers();
  getDb().prepare("UPDATE audit_log SET action = 'forged' WHERE id = 2").run();
  expect(await (await get(verifyRoute, ID.auditor)).json()).toMatchObject({ ok: false, brokenAtId: 2, rowCount: 2 });
});

const csvLines = async (res: Response) => (await res.text()).trimEnd().split("\r\n");

test("csv export: roles, headers, filters, and hash columns that match the table", async () => {
  log(3);
  log(2, "payment");
  for (const r of ["auditor", "controller_admin", "finance_manager"]) expect((await get(auditRoute, ID[r], "?format=csv")).status).toBe(200);
  for (const r of ["employee", "ap_clerk"]) expect((await get(auditRoute, ID[r], "?format=csv")).status).toBe(403);
  expect((await get(auditRoute, null, "?format=csv")).status).toBe(401);
  expect((await get(auditRoute, ID.auditor, "?format=xml")).status).toBe(400);

  const res = await get(auditRoute, ID.auditor, "?format=csv");
  expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
  expect(res.headers.get("content-disposition")).toMatch(/attachment/);
  const lines = await csvLines(res);
  expect(lines[0]).toBe("id,at,actor_id,action,entity,entity_id,before,after,prev_hash,row_hash");
  expect(lines).toHaveLength(6);
  const hashes = (getDb().prepare("SELECT row_hash FROM audit_log ORDER BY id").all() as { row_hash: string }[]).map((r) => r.row_hash);
  expect(lines.slice(1).map((l) => l.match(/"([0-9a-f]{64})"$/)![1])).toEqual(hashes);

  expect(await csvLines(await get(auditRoute, ID.auditor, "?format=csv&entity=payment"))).toHaveLength(3);
  expect(await csvLines(await get(auditRoute, ID.auditor, "?format=csv&actor=99"))).toHaveLength(1); // header only
  expect(await csvLines(await get(auditRoute, ID.auditor, "?format=csv&limit=1"))).toHaveLength(6); // paging params do not truncate an export
});

test("csv export: quotes survive and formulas are neutralised", async () => {
  writeAudit({ actorId: 1, action: "x", entity: "vendor", entityId: '=HYPERLINK("http://evil")', after: { name: 'say "hi", ok' } });
  const [, row] = await csvLines(await get(auditRoute, ID.auditor, "?format=csv"));
  expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
  expect(row).toContain(`"{""name"":""say \\""hi\\"", ok""}"`);
});

test("csv export streams every row across batches, in order, using the indexes (no sort step)", async () => {
  const db = getDb();
  db.transaction(() => log(2600, "invoice"))();
  const lines = await csvLines(await get(auditRoute, ID.auditor, "?format=csv"));
  expect(lines).toHaveLength(2601);
  const ids = lines.slice(1).map((l) => Number(l.split(",")[0]));
  expect(ids).toEqual(Array.from({ length: 2600 }, (_, i) => i + 1));
  for (const f of ["", "WHERE entity = 'invoice' AND", "WHERE actor_id = 2 AND"]) {
    const sql = `SELECT id FROM audit_log ${f || "WHERE"} (at, id) > ('', 0) ORDER BY at, id LIMIT 1000`;
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(" | ");
    expect(plan, plan).not.toMatch(/TEMP B-TREE|SCAN audit_log(?! USING)/);
  }
});

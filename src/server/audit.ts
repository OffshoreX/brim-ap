import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db";

// Hash chain: each row stores the previous row's hash and a sha256 of (previous hash + its own fields).
// Editing or deleting any row after the fact breaks every hash from there on. This file is the ONLY place hashes are computed.
const GENESIS = "";

type Fields = { at: string; actor_id: number | null; action: string; entity: string; entity_id: string | null; before: string | null; after: string | null };

// A JSON array in a fixed order, so crafted text in one field can never shift into the next one.
const hashRow = (prev: string, r: Fields) =>
  createHash("sha256").update(JSON.stringify([prev, r.actor_id, r.action, r.entity, r.entity_id, r.at, r.before, r.after])).digest("hex");

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

// Appends one chained row. immediate() takes the write lock first, so two processes cannot both read the same "last hash".
export function appendAudit(
  db: Database.Database,
  a: { actorId: number | null; action: string; entity: string; entityId?: string | number; before?: unknown; after?: unknown }
) {
  db.transaction(() => {
    const last = db.prepare("SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1").get() as { row_hash: string | null } | undefined;
    const prev = last?.row_hash ?? GENESIS;
    const row: Fields = {
      at: new Date().toISOString(), // same format the column default produces
      actor_id: a.actorId,
      action: a.action,
      entity: a.entity,
      entity_id: a.entityId === undefined ? null : String(a.entityId),
      before: json(a.before),
      after: json(a.after),
    };
    db.prepare(
      "INSERT INTO audit_log (at, actor_id, action, entity, entity_id, before, after, prev_hash, row_hash) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(row.at, row.actor_id, row.action, row.entity, row.entity_id, row.before, row.after, prev, hashRow(prev, row));
  }).immediate();
}

// Every state change goes through here so the log can't be forgotten.
export function writeAudit(a: Parameters<typeof appendAudit>[1]) {
  appendAudit(getDb(), a);
}

const ROW_SQL = "SELECT id, at, actor_id, action, entity, entity_id, before, after, prev_hash, row_hash FROM audit_log ORDER BY id";

export type AuditVerdict =
  | { ok: true; rowCount: number; headHash: string }
  | { ok: false; rowCount: number; brokenAtId: number; reason: string };

// Walks the table in id order. The first row whose link or hash does not match is reported. A row with no hash at all
// (inserted by raw SQL, skipping appendAudit) counts as broken too. headHash lets someone keep a copy outside the DB:
// deleting the newest rows leaves the rest valid, but the head would no longer match the copy.
export function verifyAuditChain(db: Database.Database = getDb()): AuditVerdict {
  let prev = GENESIS;
  let rowCount = 0;
  for (const r of db.prepare(ROW_SQL).iterate() as Iterable<Fields & { id: number; prev_hash: string | null; row_hash: string | null }>) {
    rowCount++;
    const fail = (reason: string): AuditVerdict => ({ ok: false, rowCount, brokenAtId: r.id, reason });
    if (r.row_hash === null || r.prev_hash === null) return fail("row has no hash (written outside the audit function)");
    if (r.prev_hash !== prev) return fail("link to the previous row does not match (a row was removed or changed before this one)");
    if (r.row_hash !== hashRow(prev, r)) return fail("row contents do not match its hash (row was edited)");
    prev = r.row_hash;
  }
  return { ok: true, rowCount, headHash: prev };
}

// One-off, for a database that already had audit rows when the hash columns were added. The append-only trigger blocks
// UPDATE, so it is lifted for this single transaction and restored from its own stored SQL. Existing rows are trusted as they are.
export function backfillAuditChain(db: Database.Database) {
  db.transaction(() => {
    const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'audit_log_no_update'").get() as { sql: string } | undefined;
    db.exec("DROP TRIGGER IF EXISTS audit_log_no_update");
    const set = db.prepare("UPDATE audit_log SET prev_hash = ?, row_hash = ? WHERE id = ?");
    let prev = GENESIS;
    for (const r of db.prepare(ROW_SQL).all() as (Fields & { id: number })[]) {
      const hash = hashRow(prev, r);
      set.run(prev, hash, r.id);
      prev = hash;
    }
    if (trigger) db.exec(trigger.sql);
  }).immediate();
}

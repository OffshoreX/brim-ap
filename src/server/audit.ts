import { getDb } from "./db";

// Every state change goes through here so the log can't be forgotten.
export function writeAudit(a: {
  actorId: number | null;
  action: string;
  entity: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
}) {
  getDb()
    .prepare(
      "INSERT INTO audit_log (actor_id, action, entity, entity_id, before, after) VALUES (?,?,?,?,?,?)"
    )
    .run(
      a.actorId,
      a.action,
      a.entity,
      String(a.entityId),
      a.before === undefined ? null : JSON.stringify(a.before),
      a.after === undefined ? null : JSON.stringify(a.after)
    );
}

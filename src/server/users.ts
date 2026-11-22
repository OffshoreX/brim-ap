// Controller user management. The route only checks the role (requireRole); the business guards live here
// so they are plain functions of the database and easy to test. Every change writes one audit row.
import { ROLES, type Role, type User } from "@/contracts";
import { getDb } from "./db";
import { writeAudit } from "./audit";

export class UserError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

const STATUSES = ["active", "on_leave", "terminated"] as const;
type Status = (typeof STATUSES)[number];
const CAN_DELEGATE: readonly Role[] = ["approver", "finance_manager", "controller_admin"]; // "approver or above"
const EDITABLE = ["role", "manager_id", "approval_limit_cents", "status", "delegate_user_id"] as const;

type Row = {
  id: number; name: string; email: string | null; title: string | null; role: Role; status: Status;
  manager_id: number | null; approval_limit_cents: number; delegate_user_id: number | null; status_since: string | null;
};
// Explicit columns: password_hash must never reach a response.
const COLS = "id, name, email, title, role, status, manager_id, approval_limit_cents, delegate_user_id, status_since";
const shape = (u: Row) => ({
  id: u.id, name: u.name, email: u.email, title: u.title, role: u.role, status: u.status,
  managerId: u.manager_id, approvalLimitCents: u.approval_limit_cents, delegateUserId: u.delegate_user_id,
});

export const listUsersForAdmin = () => (getDb().prepare(`SELECT ${COLS} FROM users ORDER BY id`).all() as Row[]).map(shape);

const find = (id: number) => getDb().prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(id) as Row | undefined;
const names = (rows: { name: string }[]) => rows.map((r) => r.name).join(", ");
const isId = (v: unknown): v is number => Number.isInteger(v);

export function updateUser(actor: User, id: number, patch: Record<string, unknown>) {
  const db = getDb();
  // Nobody edits their own record, whatever the field (a controller once raised their own approval limit).
  if (actor.id === id) throw new UserError(403, "Ask another controller");
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new UserError(400, "Nothing to update");
  const bad = keys.filter((k) => !(EDITABLE as readonly string[]).includes(k));
  if (bad.length) throw new UserError(400, `Not editable here: ${bad.join(", ")}`);

  // immediate(): take the write lock before reading, so two controllers cannot both pass the last-controller check.
  return db.transaction(() => {
    const before = find(id);
    if (!before) throw new UserError(404, "User not found");

    if ("role" in patch && !ROLES.includes(patch.role as Role)) throw new UserError(400, `role must be one of: ${ROLES.join(", ")}`);
    if ("status" in patch && !STATUSES.includes(patch.status as Status)) throw new UserError(400, `status must be one of: ${STATUSES.join(", ")}`);
    if ("approval_limit_cents" in patch && !(isId(patch.approval_limit_cents) && patch.approval_limit_cents >= 0))
      throw new UserError(400, "approval_limit_cents must be a whole number of cents, 0 or more");

    const next = { ...before, ...patch } as Row;

    // The company must always have someone who can manage users.
    const wasController = before.role === "controller_admin" && before.status === "active";
    if (wasController && (next.role !== "controller_admin" || next.status !== "active")) {
      const others = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'controller_admin' AND status = 'active' AND id != ?").get(id) as { n: number };
      if (others.n === 0) throw new UserError(409, "This is the last active controller. Make another user an active controller first.");
    }

    if ("manager_id" in patch && patch.manager_id !== null) {
      const m = isId(patch.manager_id) ? find(patch.manager_id) : undefined;
      if (!m) throw new UserError(400, "manager_id must be an existing user or null");
      if (m.status !== "active") throw new UserError(400, `${m.name} is ${m.status} and cannot be a manager`);
      // Walk up from the new manager; if we meet this user, the chain would loop.
      for (let cur: Row | undefined = m, hops = 0; cur && hops < 1000; cur = cur.manager_id === null ? undefined : find(cur.manager_id), hops++)
        if (cur.id === id) throw new UserError(400, "That manager would create a reporting loop");
    }

    if ("delegate_user_id" in patch && patch.delegate_user_id !== null) {
      const d = isId(patch.delegate_user_id) ? find(patch.delegate_user_id) : undefined;
      if (!d) throw new UserError(400, "delegate_user_id must be an existing user or null");
      if (d.id === id) throw new UserError(400, "A user cannot be their own delegate");
      if (d.status !== "active") throw new UserError(400, `${d.name} is ${d.status} and cannot be a delegate`);
      if (!CAN_DELEGATE.includes(d.role)) throw new UserError(400, `${d.name} is not an approver or above, so cannot be a delegate`);
    }
    if (next.status === "on_leave" && next.delegate_user_id === null) throw new UserError(400, "A user on leave needs a delegate (delegate_user_id)");

    // Terminating someone who still manages active people or covers for someone would leave them pointing at nobody.
    if (next.status === "terminated" && before.status !== "terminated") {
      const reports = db.prepare("SELECT name FROM users WHERE manager_id = ? AND status = 'active'").all(id) as { name: string }[];
      const covered = db.prepare("SELECT name FROM users WHERE delegate_user_id = ? AND status != 'terminated'").all(id) as { name: string }[];
      if (reports.length || covered.length)
        throw new UserError(409, [
          reports.length && `${before.name} is the manager of: ${names(reports)}`,
          covered.length && `${before.name} is the delegate for: ${names(covered)}`,
          "Reassign them first.",
        ].filter(Boolean).join(". "));
    }

    const changed = keys.filter((k) => next[k as keyof Row] !== before[k as keyof Row]);
    if (changed.length) {
      const sets = changed.map((k) => `${k} = ?`);
      const values = changed.map((k) => next[k as keyof Row]) as (string | number | null)[];
      if (changed.includes("status")) { sets.push("status_since = ?"); values.push(new Date().toISOString().slice(0, 10)); }
      db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
      writeAudit({
        actorId: actor.id, action: "user.update", entity: "user", entityId: id,
        before: Object.fromEntries(changed.map((k) => [k, before[k as keyof Row]])),
        after: Object.fromEntries(changed.map((k) => [k, next[k as keyof Row]])),
      });
    }
    return shape(find(id)!);
  }).immediate();
}

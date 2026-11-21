import { ROLES } from "@/contracts";
import { getDb } from "./db";
import { writeAudit } from "./audit";
import type { ApprovalRule } from "./rules/types";

export type RuleRow = {
  id: number;
  department: string | null;
  min_cents: number;
  max_cents: number;
  approver_role: string;
  active: number;
};
export type RuleInput = { department: string | null; min_cents: number; max_cents: number; approver_role: string; active: boolean };
// Ready to send: routes only forward this to the client.
export type RuleResult = { status: number; body: unknown };

const err = (error: string, status = 400): RuleResult => ({ status, body: { error } });
const get = (id: number) => getDb().prepare("SELECT * FROM approval_rules WHERE id = ?").get(id) as RuleRow | undefined;

// Returns the clean input, or an error message. Trust boundary: body is untrusted JSON.
export function parseRule(body: unknown): RuleInput | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const { department, min_cents: min, max_cents: max, approver_role: role, active = true } = b;
  if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 0) return "min_cents and max_cents must be integer cents, min_cents >= 0";
  if ((min as number) >= (max as number)) return "min_cents must be less than max_cents";
  if (!ROLES.includes(role as never)) return "approver_role must be a valid role";
  if (department != null && (typeof department !== "string" || !department.trim())) return "department must be a non-empty string or null";
  if (typeof active !== "boolean") return "active must be a boolean";
  return { department: (department as string | null | undefined)?.trim() ?? null, min_cents: min as number, max_cents: max as number, approver_role: role as string, active };
}

// Half-open ranges [a,b) and [c,d) overlap when a < d and c < b. Only active rules compete.
function overlaps(r: RuleInput, ignoreId: number): boolean {
  if (!r.active) return false;
  return !!getDb()
    .prepare(
      `SELECT 1 FROM approval_rules WHERE active = 1 AND id != ? AND department IS ? AND min_cents < ? AND ? < max_cents`
    )
    .get(ignoreId, r.department, r.max_cents, r.min_cents);
}

export const listRules = (): RuleResult => ({
  status: 200,
  body: { rules: getDb().prepare("SELECT * FROM approval_rules ORDER BY department, min_cents").all() },
});

export function createRule(actorId: number, body: unknown): RuleResult {
  const r = parseRule(body);
  if (typeof r === "string") return err(r);
  if (overlaps(r, 0)) return err("range overlaps an active rule for this department");
  const res = getDb()
    .prepare("INSERT INTO approval_rules (department, min_cents, max_cents, approver_role, active) VALUES (?,?,?,?,?)")
    .run(r.department, r.min_cents, r.max_cents, r.approver_role, r.active ? 1 : 0);
  const after = get(Number(res.lastInsertRowid))!;
  writeAudit({ actorId, action: "approval_rule.create", entity: "approval_rule", entityId: after.id, after });
  return { status: 201, body: { rule: after } };
}

export function updateRule(actorId: number, id: number, body: unknown): RuleResult {
  const before = get(id);
  if (!before) return err("Rule not found", 404);
  const r = parseRule(body);
  if (typeof r === "string") return err(r);
  if (overlaps(r, id)) return err("range overlaps an active rule for this department");
  getDb()
    .prepare("UPDATE approval_rules SET department=?, min_cents=?, max_cents=?, approver_role=?, active=? WHERE id=?")
    .run(r.department, r.min_cents, r.max_cents, r.approver_role, r.active ? 1 : 0, id);
  const after = get(id)!;
  writeAudit({ actorId, action: "approval_rule.update", entity: "approval_rule", entityId: id, before, after });
  return { status: 200, body: { rule: after } };
}

export function deleteRule(actorId: number, id: number): RuleResult {
  const before = get(id);
  if (!before) return err("Rule not found", 404);
  getDb().prepare("DELETE FROM approval_rules WHERE id = ?").run(id);
  writeAudit({ actorId, action: "approval_rule.delete", entity: "approval_rule", entityId: id, before });
  return { status: 200, body: { ok: true } };
}

// Feeds routeApproval from the database; inactive rules are never routed to.
export function loadApprovalRules(): ApprovalRule[] {
  const rows = getDb().prepare("SELECT * FROM approval_rules WHERE active = 1 ORDER BY min_cents").all() as RuleRow[];
  return rows.map((r) => ({
    minCents: r.min_cents,
    maxCents: r.max_cents,
    approverRole: r.approver_role,
    ...(r.department === null ? {} : { department: r.department }),
  }));
}

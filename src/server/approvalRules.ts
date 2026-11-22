import { getDb } from "./db";
import { writeAudit } from "./audit";
import type { ChainThresholds } from "./rules/chain.types";

export type RuleRow = { id: number; policy_id: string | null; over_cents: number; extra_role: string };
// Ready to send: routes only forward this to the client.
export type RuleResult = { status: number; body: unknown };

const err = (error: string, status = 400): RuleResult => ({ status, body: { error } });
const all = () => getDb().prepare("SELECT * FROM approval_rules ORDER BY over_cents").all() as RuleRow[];

// Reads the "Invoice total over $X" policies (P02 to P04 in the dataset) into the table. The policy text is
// prose, so the amount is parsed out of the condition and the role is the last step of `required`.
// Only runs when the table is empty, so an edited threshold is never overwritten.
export function seedApprovalRules() {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM approval_rules").get()) return;
  const policies = db
    .prepare("SELECT ext_id, condition, required FROM approval_policies WHERE rule_type = 'approval' AND condition LIKE 'Invoice total over %'")
    .all() as { ext_id: string; condition: string; required: string | null }[];
  db.transaction(() => {
    for (const p of policies) {
      const dollars = /over \$([\d,]+)/.exec(p.condition)?.[1];
      const role = p.required?.split(">").pop()?.trim();
      if (!dollars || !role) continue; // not a threshold row we understand; skipping beats guessing
      const row = { policy_id: p.ext_id, over_cents: Number(dollars.replaceAll(",", "")) * 100, extra_role: role };
      const res = db.prepare("INSERT OR IGNORE INTO approval_rules (policy_id, over_cents, extra_role) VALUES (?,?,?)").run(row.policy_id, row.over_cents, row.extra_role);
      if (res.changes) writeAudit({ actorId: null, action: "approval_rule.seed", entity: "approval_rule", entityId: Number(res.lastInsertRowid), after: row });
    }
  })();
}

// What routeApprovalChain needs. Throws (so the invoice goes to needs_review) if a level is missing.
export function loadThresholds(): ChainThresholds {
  seedApprovalRules();
  const over = (role: string) => {
    const r = all().find((x) => x.extra_role === role);
    if (!r) throw new Error(`approval chain: no threshold configured for ${role}`);
    return r.over_cents;
  };
  return { financeOverCents: over("finance_manager"), controllerOverCents: over("controller_admin"), cfoOverCents: over("cfo") };
}

export function listRules(): RuleResult {
  seedApprovalRules();
  return { status: 200, body: { rules: all() } };
}

// Only the amount is editable: the roles are the levels routeApprovalChain knows. Body is untrusted JSON.
export function updateRule(actorId: number, actorRole: string, id: number, body: unknown): RuleResult {
  const before = all().find((r) => r.id === id);
  if (!before) return err("Rule not found", 404);
  // Separation of duties: nobody edits the limit that sets their own authority. A controller's own tier, and the CFO tier that
  // caps the controller's band, go to another controller (or the CFO, who is not an editor).
  const own = actorRole === before.extra_role || (actorRole === "controller_admin" && before.extra_role === "cfo");
  if (own) return err("This rule applies to your own role. Another controller reviews changes to it.", 403);
  const over = (body as { over_cents?: unknown } | null)?.over_cents;
  if (!Number.isSafeInteger(over) || (over as number) < 0) return err("over_cents must be an integer number of cents, >= 0");
  // A higher level must never start below a lower one, or the chain would skip a step.
  const next = all().map((r) => (r.id === id ? { ...r, over_cents: over as number } : r));
  const at = (role: string) => next.find((r) => r.extra_role === role)?.over_cents ?? 0;
  if (!(at("finance_manager") <= at("controller_admin") && at("controller_admin") <= at("cfo")))
    return err("thresholds must rise: finance_manager <= controller_admin <= cfo");
  getDb().prepare("UPDATE approval_rules SET over_cents = ? WHERE id = ?").run(over, id);
  const after = all().find((r) => r.id === id)!;
  writeAudit({ actorId, action: "approval_rule.update", entity: "approval_rule", entityId: id, before, after });
  return { status: 200, body: { rule: after } };
}

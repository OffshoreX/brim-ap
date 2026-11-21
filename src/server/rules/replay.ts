import type { ChainStep } from "./chain.types";
import { canRelease, PREPARE_ROLES } from "./release";
import type { ReleaseTier } from "./types";

// Pure checks that compare what happened in the past with what our rules would do today. No DB, no LLM.
// A divergence is one disagreement; the loader in ../replayHistory.ts turns them into the report.
export type Divergence = { code: string; message: string };
export type ReplayUser = { id: string; role: string; limitCents: number; status: "active" | "on_leave" | "terminated" };
export type Recorded = { stepNo: number; userId: string; role: string; decision: "approved" | "rejected"; at: string }; // at: ISO date-time
export type ReplayInvoice = { requesterId: string; totalCadCents: number };
export type ReplayPayment = { amountCadCents: number; preparedBy: string | null; releasedBy: string | null; status: string; paidDate: string | null };

// What a person reads for each cause, and what we decided to do about it.
//   control_failure: history broke a rule we agree with, so it is flagged (read-only, no status change).
//   rule_ok: history looks odd but our rule is right (or the data simply follows a different convention), so nothing changes.
export type Verdict = "control_failure" | "rule_ok";
export const CAUSES: Record<string, { label: string; verdict: Verdict; why: string }> = {
  self_approval_not_escalated: { label: "Self approval not escalated", verdict: "control_failure", why: "P07: a requester never approves their own invoice; it goes to their manager." },
  approved_while_on_leave: { label: "Approver acted while on leave", verdict: "control_failure", why: "P08: someone on leave is replaced by the named delegate." },
  approved_while_terminated: { label: "Approver acted after termination", verdict: "control_failure", why: "A terminated user cannot approve." },
  chain_limit_below_total: { label: "Approved above every approver's limit", verdict: "control_failure", why: "Nobody in the recorded chain had a limit that covers the total." },
  step_above_own_limit: { label: "Approver signed above own limit (a higher step followed)", verdict: "rule_ok", why: "The chain is built by amount (P01-P04): a manager signs first and a higher role covers the rest, so a per-step limit is not a rule." },
  approvals_out_of_order: { label: "Steps approved out of order", verdict: "control_failure", why: "Step n+1 must come after step n; a later step was signed first." },
  different_approver: { label: "Different approver than routing", verdict: "control_failure", why: "The step was signed by someone the routing would not pick." },
  unexpected_step: { label: "Approval step our routing would not add", verdict: "rule_ok", why: "An extra approver adds control; our rule stays the minimum chain." },
  routing_failed: { label: "Routing could not build a chain", verdict: "control_failure", why: "Our routing refused (no approver, missing data); needs a person to look." },
  released_above_limit: { label: "Released above the releaser's limit", verdict: "control_failure", why: "P09/P10: the release tier of the amount does not include the releaser's role." },
  released_by_role_not_allowed: { label: "Released by a role that cannot release", verdict: "control_failure", why: "P09: AP clerks prepare, they cannot release." },
  preparer_released_own_payment: { label: "Preparer released own payment", verdict: "control_failure", why: "P11: separation of duties." },
  approver_released_payment: { label: "Invoice approver released the payment", verdict: "control_failure", why: "P11: an approver cannot release the payment." },
  released_while_on_leave: { label: "Releaser acted while on leave", verdict: "control_failure", why: "A user on leave should not release payments." },
  released_while_terminated: { label: "Releaser acted after termination", verdict: "control_failure", why: "A terminated user cannot release payments." },
  settled_without_releaser: { label: "Settled payment with no releaser", verdict: "control_failure", why: "Money moved with no recorded release." },
  prepared_by_role_not_allowed: { label: "Prepared by a role that cannot prepare", verdict: "control_failure", why: "Only clerks and finance can prepare payments." },
};

// missing_step_P02 and friends carry the policy that required the step.
export function describeCause(code: string): { label: string; verdict: Verdict; why: string } {
  if (CAUSES[code]) return CAUSES[code];
  if (code.startsWith("missing_step_")) {
    const p = code.slice("missing_step_".length);
    const what = ({ P01: "department manager", P02: "amount over the finance threshold", P03: "amount over the controller threshold", P04: "amount over the CFO threshold", P05: "new or pending-review vendor", P06: "legal vendor" } as Record<string, string>)[p] ?? p;
    return { label: `Required step skipped: ${what} (${p})`, verdict: "control_failure", why: "Our routing adds this step by policy; the recorded chain skipped it." };
  }
  return { label: code, verdict: "control_failure", why: "Unclassified." };
}

const day = (iso: string) => iso.slice(0, 10);

// Status at a given date: the dataset only says "on_leave since X", so before X the user was active.
export function statusAt(u: { status: ReplayUser["status"]; statusSince?: string | null }, date: string): ReplayUser["status"] {
  return u.status !== "active" && u.statusSince && day(u.statusSince) <= day(date) ? u.status : "active";
}

export function compareApprovals(expected: ChainStep[], recorded: Recorded[], inv: ReplayInvoice, users: Map<string, ReplayUser & { statusSince?: string | null }>): Divergence[] {
  const out: Divergence[] = [];
  const got = [...recorded].sort((a, b) => a.stepNo - b.stepNo || a.at.localeCompare(b.at));
  // A rejection ends the chain, so steps after it were never asked.
  const required = got.some((r) => r.decision === "rejected") ? expected.slice(0, got.length) : expected;

  for (const step of required) {
    const policy = /P0\d/.exec(step.reason)?.[0] ?? "P01";
    const same = got.filter((r) => r.role === step.role);
    if (!same.length) out.push({ code: `missing_step_${policy}`, message: `${step.role} step required (${step.reason}) but not recorded` });
    else if (!same.some((r) => r.userId === step.userId)) {
      const r = same[0];
      if (r.userId !== inv.requesterId) out.push({ code: "different_approver", message: `${step.role} step signed by ${r.userId}; routing picks ${step.userId} (${step.reason})` });
    }
  }
  for (const r of got) {
    // P07 whatever the routing says: nobody signs their own invoice.
    if (r.userId === inv.requesterId) out.push({ code: "self_approval_not_escalated", message: `${r.userId} approved their own invoice; it should go to their manager` });
    if (!expected.some((e) => e.role === r.role)) out.push({ code: "unexpected_step", message: `${r.role} step signed by ${r.userId}; routing adds none` });
    const u = users.get(r.userId);
    if (!u) continue;
    const s = statusAt(u, r.at);
    if (s === "on_leave") out.push({ code: "approved_while_on_leave", message: `${r.userId} approved while on leave` });
    if (s === "terminated") out.push({ code: "approved_while_terminated", message: `${r.userId} approved after termination` });
    if (r.decision === "approved" && u.limitCents < inv.totalCadCents) out.push({ code: "step_above_own_limit", message: `${r.userId} signed ${inv.totalCadCents} cents over their limit of ${u.limitCents}` });
  }
  const approvers = got.filter((r) => r.decision === "approved").map((r) => users.get(r.userId)).filter((u): u is ReplayUser => !!u);
  if (approvers.length && Math.max(...approvers.map((u) => u.limitCents)) < inv.totalCadCents)
    out.push({ code: "chain_limit_below_total", message: `highest approver limit is below the invoice total of ${inv.totalCadCents} cents` });
  for (let i = 1; i < got.length; i++)
    if (got[i].stepNo > got[i - 1].stepNo && got[i].at < got[i - 1].at) {
      out.push({ code: "approvals_out_of_order", message: `step ${got[i].stepNo} was signed before step ${got[i - 1].stepNo}` });
      break; // one finding per invoice is enough
    }
  return out;
}

const RELEASE_CODES = { role: "released_by_role_not_allowed", amount: "released_above_limit", no_tier: "released_above_limit", size: "released_above_limit", approver: "approver_released_payment", preparer: "preparer_released_own_payment" } as const;

// Runs the same canRelease the live release endpoint uses, so history and today's rule cannot drift apart.
export function checkRelease(pay: ReplayPayment, approverIds: string[], users: Map<string, ReplayUser & { statusSince?: string | null }>, tiers: readonly ReleaseTier[]): Divergence[] {
  const out: Divergence[] = [];
  const preparer = pay.preparedBy ? users.get(pay.preparedBy) : undefined;
  if (preparer && !(PREPARE_ROLES as readonly string[]).includes(preparer.role)) out.push({ code: "prepared_by_role_not_allowed", message: `${preparer.id} (${preparer.role}) prepared a payment` });
  if (!pay.releasedBy) {
    if (pay.status === "settled") out.push({ code: "settled_without_releaser", message: "settled with no released_by" });
    return out;
  }
  const u = users.get(pay.releasedBy);
  if (!u) return [...out, { code: "released_by_role_not_allowed", message: `releaser ${pay.releasedBy} is not a known user` }];
  // canRelease takes the live table's numeric ids; user ids here are those numbers as text.
  const num = (id: string | null) => (id === null ? null : Number(id));
  const res = canRelease({ id: Number(u.id), role: u.role }, { amountCadCents: pay.amountCadCents, approverIds: approverIds.map(Number), preparedBy: num(pay.preparedBy) }, tiers);
  if (!res.allowed) out.push({ code: RELEASE_CODES[res.code], message: res.reason });
  const when = pay.paidDate ?? "";
  const s = when ? statusAt(u, when) : "active";
  if (s === "on_leave") out.push({ code: "released_while_on_leave", message: `${u.id} released while on leave` });
  if (s === "terminated") out.push({ code: "released_while_terminated", message: `${u.id} released after termination` });
  return out;
}

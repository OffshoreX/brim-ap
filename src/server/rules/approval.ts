import type { ApprovalInvoice, ApprovalResult, ApprovalRule, ApprovalUser } from './types';

// Pure: picks who approves an invoice. No DB, no LLM.
export function routeApproval(
  invoice: ApprovalInvoice,
  requester: ApprovalUser,
  users: ApprovalUser[],
  rules: ApprovalRule[],
): ApprovalResult {
  const byId = new Map(users.map((u) => [u.id, u]));
  const amount = invoice.totalCents;
  const rule =
    rules.find((r) => r.department === invoice.department && amount >= r.minCents && amount < r.maxCents) ??
    rules.find((r) => r.department === undefined && amount >= r.minCents && amount < r.maxCents);
  if (!rule) return { status: 'needs_review', reason: 'no approval rule matches this amount and department' };

  // Start at the role's approver; a requester never approves their own invoice, so go to their manager.
  // ponytail: first user with the role in list order; add load balancing if roles have many people.
  let current = users.find((u) => u.role === rule.approverRole);
  if (current?.id === requester.id) current = requester.managerId ? byId.get(requester.managerId) : undefined;

  const seen = new Set<string>(); // guards against manager cycles
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const ok = (u: ApprovalUser) => u.id !== requester.id && u.limitCents >= amount;
    if (ok(current)) {
      if (!current.onLeave) return { status: 'routed', approverId: current.id, delegated: false, reason: `approver role ${rule.approverRole}` };
      const d = current.delegateId ? byId.get(current.delegateId) : undefined;
      if (d && !d.onLeave && ok(d))
        return { status: 'routed', approverId: d.id, delegated: true, delegatedFromId: current.id, reason: `${current.id} on leave, delegated` };
    }
    current = current.managerId ? byId.get(current.managerId) : undefined; // escalate up the chain
  }
  return { status: 'needs_review', reason: 'no one in the approval chain has a high enough limit' };
}

import type { ChainDepartment, ChainInvoice, ChainStep, ChainThresholds, ChainUser, ChainVendor } from './chain.types';

const NEW_VENDOR_DAYS = 60;
const DAY_MS = 86_400_000;

const isNewVendor = (onboardedAt: string | undefined, invoiceDate: string) => {
  if (!onboardedAt) return false;
  const days = (Date.parse(invoiceDate) - Date.parse(onboardedAt)) / DAY_MS;
  return days >= 0 && days <= NEW_VENDOR_DAYS;
};

// Pure function: builds the ordered approval chain from policy P01-P08. Throws if nobody can fill a step
// (callers should treat that as "needs review"); it never skips a step silently.
export function routeApprovalChain(
  invoice: ChainInvoice,
  requester: ChainUser,
  vendor: ChainVendor,
  users: ChainUser[],
  departments: ChainDepartment[],
  thresholds: ChainThresholds,
): ChainStep[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  const get = (id: string) => {
    const u = byId.get(id);
    if (!u) throw new Error(`approval chain: unknown user ${id}`);
    return u;
  };

  // ponytail: the dataset has no 'cfo' role (the CFO is a controller_admin with no manager), so top-of-hierarchy stands in.
  // Several holders of one role: lowest id wins; add an explicit approver id to thresholds if that matters.
  const holder = (role: string): ChainUser => {
    const top = (u: ChainUser) => !u.managerId;
    const pool = users.filter((u) =>
      role === 'cfo' ? u.role === 'cfo' || (u.role === 'controller_admin' && top(u))
      : role === 'controller_admin' ? u.role === role && !top(u)
      : u.role === role);
    const found = pool.filter((u) => u.status !== 'terminated').sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!found) throw new Error(`approval chain: no one holds role ${role}`);
    return found;
  };

  // P07 self-approval and terminated approvers go to the manager (P07); on_leave goes to the delegate (P08).
  const resolve = (start: ChainUser): { user: ChainUser; reason?: string; delegatedFrom?: string } => {
    let u = start;
    let delegatedFrom: string | undefined;
    let reason: string | undefined;
    for (let hops = 0; hops <= users.length; hops++) {
      const up = () => {
        if (!u.managerId) throw new Error(`approval chain: ${u.id} cannot approve and has no manager`);
        return get(u.managerId);
      };
      if (u.id === requester.id) { reason = 'P07 requester is the approver; escalated to manager'; u = up(); continue; }
      if (u.status === 'terminated') { reason = 'terminated approver; escalated to manager'; u = up(); continue; }
      if (u.status === 'on_leave' && u.delegateId && !delegatedFrom) {
        const d = get(u.delegateId);
        if (d.id !== requester.id && d.status === 'active') { delegatedFrom = u.id; reason = 'P08 approver on leave; routed to delegate'; u = d; continue; }
      }
      if (u.status === 'on_leave' && !delegatedFrom) { reason = 'approver on leave with no usable delegate; escalated to manager'; u = up(); continue; }
      return { user: u, reason, delegatedFrom };
    }
    throw new Error('approval chain: could not resolve approver');
  };

  const dept = departments.find((d) => d.id === requester.departmentId);
  if (!dept) throw new Error(`approval chain: no department for requester ${requester.id}`);

  const wanted: { role: string; user: ChainUser; reason: string }[] = [
    { role: 'dept_manager', user: get(dept.managerUserId), reason: 'P01 department manager' },
  ];
  const t = invoice.totalCadCents;
  const vendorReasons: string[] = [];
  // on_hold is not in the policy text, but history sends every on_hold vendor invoice through finance (T45 replay), so it is treated like pending_review.
  if (vendor.status === 'pending_review' || vendor.status === 'on_hold') vendorReasons.push(`P05 vendor ${vendor.status.replace('_', ' ')}`);
  if (isNewVendor(vendor.onboardedAt, invoice.date)) vendorReasons.push(`P05 vendor onboarded within ${NEW_VENDOR_DAYS} days`);
  if (vendor.category === 'Legal') vendorReasons.push('P06 legal vendor');
  if (t > thresholds.financeOverCents) vendorReasons.unshift('P02 total over finance threshold');
  if (vendorReasons.length) wanted.push({ role: 'finance_manager', user: holder('finance_manager'), reason: vendorReasons.join('; ') });
  if (t > thresholds.controllerOverCents) wanted.push({ role: 'controller_admin', user: holder('controller_admin'), reason: 'P03 total over controller threshold' });
  if (t > thresholds.cfoOverCents) wanted.push({ role: 'cfo', user: holder('cfo'), reason: 'P04 total over CFO threshold' });

  const seen = new Set<string>(); // one person approves once, even if two steps land on them
  const steps: ChainStep[] = [];
  for (const w of wanted) {
    const r = resolve(w.user);
    if (seen.has(r.user.id)) continue;
    seen.add(r.user.id);
    const step: ChainStep = { stepNo: steps.length + 1, role: w.role, userId: r.user.id, reason: r.reason ? `${w.reason}; ${r.reason}` : w.reason };
    if (r.delegatedFrom) step.delegatedFrom = r.delegatedFrom;
    steps.push(step);
  }
  return steps;
}

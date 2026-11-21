import { describe, expect, it } from 'vitest';
import { routeApproval } from './approval';
import type { ApprovalUser } from './types';

const u = (id: string, role: string, limitCents: number, extra: Partial<ApprovalUser> = {}): ApprovalUser => ({ id, role, limitCents, ...extra });
const ceo = u('ceo', 'exec', 10_000_000);
const mgr = u('mgr', 'manager', 100_000, { managerId: 'ceo' });
const clerk = u('clerk', 'clerk', 0, { managerId: 'mgr' });
const users = [mgr, ceo, clerk];
const rules = [
  { minCents: 0, maxCents: 100_001, approverRole: 'manager' },
  { minCents: 100_001, maxCents: 10_000_001, approverRole: 'exec' },
];
const inv = (totalCents: number) => ({ totalCents, department: 'ops' });

describe('routeApproval', () => {
  it('routes a normal invoice to the rule role', () => {
    expect(routeApproval(inv(5_000), clerk, users, rules)).toMatchObject({ status: 'routed', approverId: 'mgr', delegated: false });
  });
  it('amount exactly at the limit stays with the manager', () => {
    expect(routeApproval(inv(100_000), clerk, users, rules)).toMatchObject({ approverId: 'mgr' });
  });
  it('one cent over the limit goes to the exec', () => {
    expect(routeApproval(inv(100_001), clerk, users, rules)).toMatchObject({ approverId: 'ceo' });
  });
  it('requester who holds the approver role escalates to their manager', () => {
    expect(routeApproval(inv(5_000), mgr, users, rules)).toMatchObject({ approverId: 'ceo' });
  });
  it('on-leave approver routes to the delegate and marks it delegated', () => {
    const del = u('del', 'manager', 100_000);
    const away = { ...mgr, onLeave: true, delegateId: 'del' };
    expect(routeApproval(inv(5_000), clerk, [away, ceo, clerk, del], rules)).toMatchObject({
      approverId: 'del', delegated: true, delegatedFromId: 'mgr',
    });
  });
  it('on leave without a usable delegate escalates up the chain', () => {
    const away = { ...mgr, onLeave: true };
    expect(routeApproval(inv(5_000), clerk, [away, ceo, clerk], rules)).toMatchObject({ approverId: 'ceo', delegated: false });
  });
  it('escalates when the role approver limit is too low', () => {
    const lowRules = [{ minCents: 0, maxCents: 1_000_000, approverRole: 'manager' }];
    expect(routeApproval(inv(500_000), clerk, users, lowRules)).toMatchObject({ approverId: 'ceo' });
  });
  it('needs_review when nobody in the chain has enough limit', () => {
    const r = [{ minCents: 0, maxCents: 99_999_999, approverRole: 'manager' }];
    expect(routeApproval(inv(50_000_000), clerk, users, r).status).toBe('needs_review');
  });
  it('needs_review when the chain runs out (requester is the top)', () => {
    expect(routeApproval(inv(5_000), ceo, users, [{ minCents: 0, maxCents: 100, approverRole: 'exec' }, { minCents: 100, maxCents: 10_000, approverRole: 'exec' }]).status).toBe('needs_review');
  });
  it('needs_review when no rule matches', () => {
    expect(routeApproval(inv(5_000), clerk, users, []).status).toBe('needs_review');
  });
  it('department rule beats a generic rule', () => {
    const r = [{ ...rules[0] }, { minCents: 0, maxCents: 100_001, department: 'ops', approverRole: 'exec' }];
    expect(routeApproval(inv(5_000), clerk, users, r)).toMatchObject({ approverId: 'ceo' });
  });
});

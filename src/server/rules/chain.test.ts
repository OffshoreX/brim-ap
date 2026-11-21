import { describe, expect, it } from 'vitest';
import { routeApprovalChain } from './chain';
import type { ChainUser, ChainVendor } from './chain.types';

// Test data only: the rule knows no ids, thresholds or amounts.
const u = (id: string, role: string, managerId?: string, extra: Partial<ChainUser> = {}): ChainUser =>
  ({ id, role, managerId, departmentId: 'dX', status: 'active', ...extra });
const users: ChainUser[] = [
  u('boss', 'controller_admin'), // top of hierarchy = stands in for CFO
  u('ctrl', 'controller_admin', 'boss'),
  u('fin', 'finance_manager', 'ctrl'),
  u('mgr', 'dept_manager', 'fin'),
  u('emp', 'employee', 'mgr'),
];
const departments = [{ id: 'dX', managerUserId: 'mgr' }];
const T = { financeOverCents: 1000000, controllerOverCents: 5000000, cfoOverCents: 25000000 };
const vendor: ChainVendor = { status: 'active', category: 'Freight', onboardedAt: '2020-01-01' };
const day = '2026-11-20';
const run = (cents: number, o: { requester?: ChainUser; vendor?: ChainVendor; users?: ChainUser[] } = {}) =>
  routeApprovalChain({ totalCadCents: cents, date: day }, o.requester ?? users[4], o.vendor ?? vendor, o.users ?? users, departments, T);
const ids = (s: { userId: string }[]) => s.map((x) => x.userId);

describe('routeApprovalChain', () => {
  it('at the finance threshold: manager only', () => expect(ids(run(1000000))).toEqual(['mgr']));
  it('one cent over finance threshold adds finance manager', () => expect(ids(run(1000001))).toEqual(['mgr', 'fin']));
  it('at the controller threshold: no controller', () => expect(ids(run(5000000))).toEqual(['mgr', 'fin']));
  it('one cent over controller threshold adds controller', () => expect(ids(run(5000001))).toEqual(['mgr', 'fin', 'ctrl']));
  it('at the CFO threshold: no CFO', () => expect(ids(run(25000000))).toEqual(['mgr', 'fin', 'ctrl']));
  it('one cent over CFO threshold adds CFO', () => expect(ids(run(25000001))).toEqual(['mgr', 'fin', 'ctrl', 'boss']));
  it('steps are numbered from 1 with a reason', () => {
    const s = run(25000001);
    expect(s.map((x) => x.stepNo)).toEqual([1, 2, 3, 4]);
    expect(s.every((x) => x.reason.length > 0)).toBe(true);
  });
  it('Legal vendor adds finance manager at any amount', () => expect(ids(run(100, { vendor: { ...vendor, category: 'Legal' } }))).toEqual(['mgr', 'fin']));
  it('pending_review vendor adds finance manager', () => expect(ids(run(100, { vendor: { ...vendor, status: 'pending_review' } }))).toEqual(['mgr', 'fin']));
  it('new vendor (60 days) adds finance manager; 61 days does not', () => {
    expect(ids(run(100, { vendor: { ...vendor, onboardedAt: '2026-09-21' } }))).toEqual(['mgr', 'fin']);
    expect(ids(run(100, { vendor: { ...vendor, onboardedAt: '2026-09-20' } }))).toEqual(['mgr']);
  });
  it('vendor flag plus amount gives one finance step, not two', () =>
    expect(ids(run(1000001, { vendor: { ...vendor, category: 'Legal' } }))).toEqual(['mgr', 'fin']));
  it('requester is the department manager: replaced by their manager', () => {
    const s = run(100, { requester: users[3] });
    expect(ids(s)).toEqual(['fin']);
    expect(s[0].reason).toMatch(/P07/);
  });
  it('requester is the finance manager: that step moves up to the controller', () =>
    expect(ids(run(1000001, { requester: users[2] }))).toEqual(['mgr', 'ctrl']));
  it('approver on leave routes to delegate and records it', () => {
    const us = users.map((x) => (x.id === 'mgr' ? { ...x, status: 'on_leave' as const, delegateId: 'fin' } : x));
    const s = run(100, { users: us });
    expect(s).toMatchObject([{ userId: 'fin', delegatedFrom: 'mgr' }]);
  });
  it('terminated approver is skipped to their manager', () => {
    const us = users.map((x) => (x.id === 'mgr' ? { ...x, status: 'terminated' as const } : x));
    expect(ids(run(100, { users: us }))).toEqual(['fin']);
  });
  it('duplicates removed: delegate already on the chain appears once, steps renumbered', () => {
    const us = users.map((x) => (x.id === 'mgr' ? { ...x, status: 'on_leave' as const, delegateId: 'fin' } : x));
    const s = run(1000001, { users: us });
    expect(ids(s)).toEqual(['fin']);
    expect(s[0].stepNo).toBe(1);
  });
  it('throws instead of skipping when the top person is the requester', () =>
    expect(() => run(100, { requester: users[0], users: users.map((x) => (x.id === 'mgr' ? { ...x, managerId: undefined, status: 'terminated' as const } : x)) })).toThrow());
});

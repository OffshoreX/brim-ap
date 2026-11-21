import { describe, expect, it, test } from "vitest";
import type { ChainStep } from "./chain.types";
import { checkRelease, compareApprovals, describeCause, statusAt, type Recorded, type ReplayUser } from "./replay";
import type { ReleaseTier } from "./types";

// Test data only: nothing here is a dataset id or amount.
const user = (id: string, role: string, limitCents: number, extra: Partial<ReplayUser & { statusSince: string }> = {}) => ({ id, role, limitCents, status: "active" as const, ...extra });
const users = new Map([
  user("1", "approver", 1_000), user("2", "finance_manager", 5_000), user("3", "approver", 1_000),
  user("4", "ap_clerk", 0), user("5", "controller_admin", 50_000), user("6", "finance_manager", 5_000, { status: "on_leave", statusSince: "2026-05-01" }),
].map((u) => [u.id, u]));
const step = (stepNo: number, role: string, userId: string, reason = "P01 department manager"): ChainStep => ({ stepNo, role, userId, reason });
const rec = (stepNo: number, userId: string, role: string, at: string, decision: "approved" | "rejected" = "approved"): Recorded => ({ stepNo, userId, role, decision, at });
const inv = { requesterId: "9", totalCadCents: 800 };
const codes = (d: { code: string }[]) => d.map((x) => x.code);
const T0 = "2026-02-01T09:00:00";
const T1 = "2026-02-01T10:00:00";

describe("compareApprovals", () => {
  const chain = [step(1, "dept_manager", "1"), step(2, "finance_manager", "2", "P02 total over finance threshold")];
  it("a matching chain has no findings", () => expect(compareApprovals(chain, [rec(1, "1", "dept_manager", T0), rec(2, "2", "finance_manager", T1)], inv, users)).toEqual([]));
  it("missing step carries the policy that required it", () => expect(codes(compareApprovals(chain, [rec(1, "1", "dept_manager", T0)], inv, users))).toEqual(["missing_step_P02"]));
  it("an extra step is reported but is not a control failure by itself", () => {
    const d = compareApprovals([chain[0]], [rec(1, "1", "dept_manager", T0), rec(2, "2", "finance_manager", T1)], inv, users);
    expect(codes(d)).toEqual(["unexpected_step"]);
    expect(describeCause("unexpected_step").verdict).toBe("rule_ok");
  });
  it("requester approving their own invoice is self approval", () =>
    expect(codes(compareApprovals([step(1, "dept_manager", "2")], [rec(1, "1", "dept_manager", T0)], { ...inv, requesterId: "1" }, users))).toEqual(["self_approval_not_escalated"]));
  it("a different person on the step is reported", () => expect(codes(compareApprovals([chain[0]], [rec(1, "3", "dept_manager", T0)], inv, users))).toEqual(["different_approver"]));
  it("steps signed in the wrong time order are reported once", () =>
    expect(codes(compareApprovals(chain, [rec(1, "1", "dept_manager", T1), rec(2, "2", "finance_manager", T0)], inv, users))).toEqual(["approvals_out_of_order"]));
  it("a rejection ends the chain: later steps are not missing", () => expect(compareApprovals(chain, [rec(1, "1", "dept_manager", T0, "rejected")], inv, users)).toEqual([]));
  it("approver on leave on the day is reported; before the leave started is not", () => {
    const c = [step(1, "finance_manager", "6")];
    expect(codes(compareApprovals(c, [rec(1, "6", "finance_manager", "2026-06-01T09:00:00")], inv, users))).toEqual(["approved_while_on_leave"]);
    expect(compareApprovals(c, [rec(1, "6", "finance_manager", "2026-04-01T09:00:00")], inv, users)).toEqual([]);
  });
  it("a first step over the signer's own limit is rule_ok when a higher limit follows", () => {
    const big = { ...inv, totalCadCents: 3_000 };
    const d = compareApprovals(chain, [rec(1, "1", "dept_manager", T0), rec(2, "2", "finance_manager", T1)], big, users);
    expect(codes(d)).toEqual(["step_above_own_limit"]);
    expect(describeCause("step_above_own_limit").verdict).toBe("rule_ok");
  });
  it("nobody in the chain covering the total is a control failure", () =>
    expect(codes(compareApprovals([chain[0]], [rec(1, "1", "dept_manager", T0)], { ...inv, totalCadCents: 99_999 }, users))).toContain("chain_limit_below_total"));
});

describe("checkRelease", () => {
  const tiers: ReleaseTier[] = [{ upToCents: 4_000, roles: ["finance_manager", "controller_admin"] }, { upToCents: null, roles: ["controller_admin"] }];
  const pay = (o: Partial<Parameters<typeof checkRelease>[0]> = {}) => ({ amountCadCents: 100, preparedBy: "4", releasedBy: "2", status: "settled", paidDate: "2026-02-03", ...o });
  it("a clean release has no findings", () => expect(checkRelease(pay(), ["1"], users, tiers)).toEqual([]));
  it("above the releaser's tier", () => expect(codes(checkRelease(pay({ amountCadCents: 4_001 }), ["1"], users, tiers))).toEqual(["released_above_limit"]));
  it("a clerk cannot release", () => expect(codes(checkRelease(pay({ releasedBy: "4", preparedBy: "5" }), ["1"], users, tiers))).toEqual(["released_by_role_not_allowed"]));
  it("preparer releasing their own payment", () => expect(codes(checkRelease(pay({ preparedBy: "2" }), ["1"], users, tiers))).toContain("preparer_released_own_payment"));
  it("invoice approver releasing the payment", () => expect(codes(checkRelease(pay(), ["2"], users, tiers))).toEqual(["approver_released_payment"]));
  it("settled with no releaser", () => expect(codes(checkRelease(pay({ releasedBy: null }), ["1"], users, tiers))).toEqual(["settled_without_releaser"]));
  it("a scheduled payment with no releaser is fine", () => expect(checkRelease(pay({ releasedBy: null, status: "scheduled", paidDate: null }), ["1"], users, tiers)).toEqual([]));
  it("preparer role that cannot prepare", () => expect(codes(checkRelease(pay({ preparedBy: "1" }), ["3"], users, tiers))).toEqual(["prepared_by_role_not_allowed"]));
  it("releaser on leave on the paid date", () => expect(codes(checkRelease(pay({ releasedBy: "6", paidDate: "2026-06-01" }), ["1"], users, tiers))).toEqual(["released_while_on_leave"]));
});

test("a missing-step cause names the policy that required it", () => expect(describeCause("missing_step_P05").label).toMatch(/P05/));

describe("statusAt", () => {
  it("applies a status only from its start date", () => {
    expect(statusAt({ status: "on_leave", statusSince: "2026-05-01" }, "2026-04-30")).toBe("active");
    expect(statusAt({ status: "on_leave", statusSince: "2026-05-01" }, "2026-05-01T08:00:00")).toBe("on_leave");
  });
});

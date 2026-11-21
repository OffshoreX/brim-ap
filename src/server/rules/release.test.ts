import { describe, expect, it } from "vitest";
import { canRelease, earlyPayDiscountCents } from "./release";
import type { ReleaseTier } from "./types";

// Tiers are an argument, so the tests use their own table (CAD cents): up to 100,000.00, then no limit.
const tiers: ReleaseTier[] = [
  { upToCents: 10_000_000, roles: ["finance_manager", "controller_admin"] },
  { upToCents: null, roles: ["controller_admin"] },
];
const user = (role: string, id = 10) => ({ id, role });
const pay = (amountCadCents: number, approverIds: number[] = [1], preparedBy: number | null = 2) => ({ amountCadCents, approverIds, preparedBy });
const reason = (r: ReturnType<typeof canRelease>) => (r.allowed ? "" : r.reason);

describe("canRelease: size tiers", () => {
  it("allows finance_manager and controller_admin under the limit", () => {
    expect(canRelease(user("finance_manager"), pay(5_000), tiers)).toEqual({ allowed: true });
    expect(canRelease(user("controller_admin"), pay(5_000), tiers)).toEqual({ allowed: true });
  });
  it("allows finance_manager at exactly 100,000.00", () => expect(canRelease(user("finance_manager"), pay(10_000_000), tiers).allowed).toBe(true));
  it("blocks finance_manager one cent over 100,000.00", () => {
    const r = canRelease(user("finance_manager"), pay(10_000_001), tiers);
    expect(r.allowed).toBe(false);
    expect(reason(r)).toMatch(/this size/);
  });
  it("allows controller_admin one cent over and far above", () => {
    expect(canRelease(user("controller_admin"), pay(10_000_001), tiers).allowed).toBe(true);
    expect(canRelease(user("controller_admin"), pay(9_000_000_000), tiers).allowed).toBe(true);
  });
  it("reads the limit from the table it is given", () => {
    const small: ReleaseTier[] = [{ upToCents: 100, roles: ["finance_manager"] }, { upToCents: null, roles: ["controller_admin"] }];
    expect(canRelease(user("finance_manager"), pay(100), small).allowed).toBe(true);
    expect(canRelease(user("finance_manager"), pay(101), small).allowed).toBe(false);
  });
  it("blocks when no tier covers the amount", () => expect(canRelease(user("finance_manager"), pay(1), []).allowed).toBe(false));
});

describe("canRelease: roles", () => {
  it.each(["ap_clerk", "approver", "auditor", "employee", "hacker"])("blocks %s", (role) => expect(canRelease(user(role), pay(1), tiers).allowed).toBe(false));
  it("blocks clerk and approver even if a table row lists them", () => {
    const bad: ReleaseTier[] = [{ upToCents: null, roles: ["ap_clerk", "approver"] }];
    expect(canRelease(user("ap_clerk"), pay(1), bad).allowed).toBe(false);
    expect(canRelease(user("approver"), pay(1), bad).allowed).toBe(false);
  });
  it("blocks non-integer or non-positive amounts", () => {
    expect(canRelease(user("finance_manager"), pay(10.5), tiers).allowed).toBe(false);
    expect(canRelease(user("finance_manager"), pay(0), tiers).allowed).toBe(false);
  });
});

describe("canRelease: separation of duties", () => {
  it("blocks a releaser who approved the invoice", () => {
    const r = canRelease(user("finance_manager", 7), pay(5_000, [1, 7]), tiers);
    expect(r.allowed).toBe(false);
    expect(reason(r)).toMatch(/approved/);
  });
  it("blocks the preparer", () => {
    const r = canRelease(user("controller_admin", 2), pay(5_000, [1], 2), tiers);
    expect(r.allowed).toBe(false);
    expect(reason(r)).toMatch(/prepared/);
  });
  it("allows someone who neither approved nor prepared", () => expect(canRelease(user("controller_admin", 9), pay(5_000, [1], 2), tiers).allowed).toBe(true));
});

describe("earlyPayDiscountCents", () => {
  const d = (terms: string | null, paid: string) => earlyPayDiscountCents(terms, "2026-01-05", paid, 185_665);
  it("applies 2% of the subtotal inside the window (real dataset figure 37.13)", () => expect(d("2/10 net 30", "2026-01-14")).toBe(3713));
  it("applies on the last day of the window", () => expect(d("2/10 net 30", "2026-01-15")).toBe(3713));
  it("gives nothing one day after the window", () => expect(d("2/10 net 30", "2026-01-16")).toBe(0));
  it("gives nothing for no terms, odd terms, or a payment dated before the invoice", () => {
    expect(d(null, "2026-01-06")).toBe(0);
    expect(d("net 30", "2026-01-06")).toBe(0);
    expect(d("2/10 net 30", "2026-01-04")).toBe(0);
  });
  it("rounds half up in whole cents", () => expect(earlyPayDiscountCents("1/10 net 30", "2026-01-05", "2026-01-05", 150)).toBe(2));
});

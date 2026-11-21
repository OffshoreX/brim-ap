import { describe, expect, it } from "vitest";
import { canRelease } from "./release";

const u = (role: string, limit = 100_000) => ({ role, releaseLimitCents: limit });
const pay = (amountCents: number) => ({ amountCents });

describe("canRelease", () => {
  it("allows finance_manager within limit", () => expect(canRelease(u("finance_manager"), pay(5_000))).toEqual({ allowed: true }));
  it("allows controller_admin within limit", () => expect(canRelease(u("controller_admin"), pay(5_000))).toEqual({ allowed: true }));
  it("allows exactly at the limit", () => expect(canRelease(u("finance_manager"), pay(100_000)).allowed).toBe(true));
  it("blocks one cent over the limit", () => {
    const r = canRelease(u("controller_admin"), pay(100_001));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/limit/);
  });
  it("blocks approver even with a big limit", () => expect(canRelease(u("approver", 1e9), pay(1)).allowed).toBe(false));
  it("blocks auditor", () => expect(canRelease(u("auditor", 1e9), pay(1)).allowed).toBe(false));
  it("blocks employee", () => expect(canRelease(u("employee", 1e9), pay(1)).allowed).toBe(false));
  it("blocks ap_clerk", () => expect(canRelease(u("ap_clerk", 1e9), pay(1)).allowed).toBe(false));
  it("blocks non-integer or non-positive amounts", () => {
    expect(canRelease(u("finance_manager"), pay(10.5)).allowed).toBe(false);
    expect(canRelease(u("finance_manager"), pay(0)).allowed).toBe(false);
  });
  it("blocks unknown role", () => expect(canRelease(u("hacker", 1e9), pay(1)).allowed).toBe(false));
});

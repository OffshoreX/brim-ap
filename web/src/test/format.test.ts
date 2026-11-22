import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/roles";

describe("money", () => {
  it("formats integer cents with currency code", () => {
    expect(formatMoney(123456, "CAD")).toBe("1,234.56 CAD");
  });
});
describe("roles", () => {
  it("only finance manager and controller can release payments", () => {
    expect(can("finance_manager", "release")).toBe(true);
    expect(can("controller_admin", "release")).toBe(true);
    expect(can("ap_clerk", "release")).toBe(false);
  });
});

import { plural } from "@/lib/format";
describe("plural", () => {
  it("uses singular for exactly one", () => {
    expect(plural(1, "invoice")).toBe("1 invoice");
    expect(plural(0, "invoice")).toBe("0 invoices");
    expect(plural(22, "flag")).toBe("22 flags");
  });
});

// The label lookup gives words for known codes and a humanised string, never the raw code, for unknown ones.
import { expect, test } from "vitest";
import { bankChangeStatus, flagTitle, humanise, inboxClass, roleName, vendorStatus } from "./labels";

test("known codes get their plain title", () => {
  expect(roleName("ap_clerk")).toBe("Clerk");
  expect(roleName("controller_admin")).toBe("Controller");
  expect(flagTitle("DUPLICATE_NEAR")).toBe("Possible duplicate");
  expect(inboxClass("bank_change")).toBe("Bank-change request");
  expect(vendorStatus("on_hold")).toBe("On hold");
  expect(bankChangeStatus("pending")).toBe("Waiting for a callback");
});

test("unknown or missing values are humanised, not printed as codes", () => {
  expect(flagTitle("some_new_check")).toBe("Some new check");
  expect(roleName("SENIOR_buyer")).toBe("Senior buyer");
  expect(humanise("vendor.bank_change_requested")).toBe("Vendor bank change requested");
  expect(vendorStatus(null)).toBe("Unknown");
  expect(inboxClass("")).toBe("Unknown");
});

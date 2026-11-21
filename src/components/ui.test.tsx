// Tests for the display-only components: status and severity use text as well as colour; nav links follow the role.
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));
import { linksFor } from "./Header";
import { Flags, money } from "./api";
import { SeverityChip, StatusBadge } from "./ui";

test("every status shows readable text, not just a colour class", () => {
  for (const s of ["received", "needs_review", "pending_approval", "approved", "scheduled", "paid", "rejected"]) {
    const html = renderToString(<StatusBadge status={s} />);
    expect(html).toContain(`badge-${s}`);
    expect(html).not.toContain(">" + s + "<"); // label is words, not the raw code
  }
  expect(renderToString(<StatusBadge status="needs_review" />)).toContain("Needs review");
});

test("flag severities show a text label and fall back to info", () => {
  expect(renderToString(<SeverityChip severity="error" />)).toContain("Error");
  expect(renderToString(<SeverityChip severity="warning" />)).toContain("Warning");
  expect(renderToString(<SeverityChip />)).toContain("Info");
  expect(renderToString(<Flags flags={[{ code: "tax_mismatch", message: "Tax is off", severity: "error" }]} />)).toContain("Error");
});

test("nav shows only links useful to the role, and none before sign-in", () => {
  const names = (r?: Parameters<typeof linksFor>[0]) => linksFor(r).map(([, n]) => n);
  expect(names()).toEqual([]);
  expect(names("employee")).toEqual(["Dashboard", "Invoices", "Upload"]);
  expect(names("controller_admin")).toContain("Approval rules");
  expect(names("approver")).not.toContain("Approval rules");
});

test("money is formatted from integer cents", () => {
  expect(money(123456, "CAD")).toBe("1,234.56 CAD");
  expect(money(-5)).toBe("-0.05");
  expect(money(null)).toBe("—");
});

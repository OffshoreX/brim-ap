// Role landing smoke test: fetch is mocked per endpoint, then every role's landing counters are loaded
// through the same code the page uses, and the role-to-landing map is checked.
import { afterEach, expect, test, vi } from "vitest";
import { ROLES } from "@/contracts";
import { HOME, loadCounters } from "@/components/RoleHome";

const inv = (status: string) => ({ id: 1, status });
const DATA: Record<string, unknown> = {
  "/api/invoices": [inv("approved"), inv("pending_approval"), inv("pending_approval"), inv("needs_review"), inv("rejected")],
  "/api/approvals/inbox": [{ invoiceId: 1 }, { invoiceId: 2 }],
  "/api/exceptions": [{ id: 1 }],
  "/api/payments": [{ status: "scheduled" }, { status: "paid" }],
  "/api/dashboard": { countsByStatus: { pending_approval: 4 }, needsReview: 3, dueThisWeekCadCents: 250000 },
  "/api/audit": [{ id: 1 }, { id: 2 }, { id: 3 }],
};
afterEach(() => vi.unstubAllGlobals());
const serve = (denied: string[] = []) =>
  vi.stubGlobal("fetch", async (url: string) => denied.includes(url) ? new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) : new Response(JSON.stringify(DATA[url])));

test("each role lands on its own screen", () => {
  expect(Object.fromEntries(ROLES.map((r) => [r, HOME[r].path]))).toEqual({
    employee: "/invoices", approver: "/approvals", ap_clerk: "/upload", finance_manager: "/payments", controller_admin: "/dashboard", auditor: "/audit",
  });
});

const EXPECTED: Record<string, (string | number)[]> = {
  employee: [5, 2, 1], approver: [2, 2, 1], ap_clerk: [1, 1, 1], finance_manager: [2, 1, 1], controller_admin: [3, 4, "2,500.00 CAD"], auditor: [3, 2, 5],
};
test.each(ROLES)("%s landing shows 3 counters from the endpoints", async (role) => {
  serve();
  const counters = await loadCounters(role);
  expect(counters).toHaveLength(3);
  expect(counters.map((c) => c.value)).toEqual(EXPECTED[role]);
});

test("a 403 shows a dash, never a made-up number, and tells the header", async () => {
  serve(["/api/audit"]);
  const seen: string[] = [];
  vi.stubGlobal("window", { dispatchEvent: (e: CustomEvent) => seen.push(e.detail) });
  expect((await loadCounters("auditor"))[0].value).toBe("–");
  expect(seen).toEqual(["Not allowed: Forbidden"]);
});

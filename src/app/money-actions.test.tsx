// Page-level checks for the money actions: the decision bar content and the accessible name of every row action.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

const payment = { id: 7, invoiceId: 1, invoiceNumber: "INV-1", vendorName: "Acme Ltd", method: "EFT", methodLabel: "EFT", status: "scheduled", scheduledDate: "2026-12-01", paidAt: null, amountCents: 123456, currency: "CAD", reference: null };
const blocking = { code: "bank_details_changed", message: "Bank details changed since the last payment", severity: "error" };
const DATA: Record<string, unknown> = {
  "/api/invoices/1": {
    id: 1, status: "pending_approval", invoiceNumber: "INV-1", invoiceDate: "2026-11-01", dueDate: "2026-12-01", subtotalCents: 100000, gstHstCents: 23456, pstQstCents: 0,
    totalCents: 123456, currency: "CAD", vendorName: "Acme Ltd", extraction: {}, flags: [{ code: "amount_outlier", message: "Unusual amount", severity: "warning" }, blocking], lines: [],
    approvalChain: [
      { stepNo: 1, role: "dept_manager", roleLabel: "Department manager", actorName: "Dana Reyes", delegatedFromId: 5, delegatedFromName: "Sam Lee", reason: "Requester cannot approve own invoice", status: "pending" },
      { stepNo: 2, role: "cfo", roleLabel: "CFO", actorName: null, delegatedFromId: null, delegatedFromName: null, reason: null, status: "pending" },
    ],
    approvals: [], payments: [payment],
  },
  "/api/invoices/1/trail": [],
  "/api/payments": [payment],
  "/api/payments/cheques": { cheques: [] },
};
vi.mock("@/components/api", async (orig) => ({
  ...(await orig<typeof import("@/components/api")>()),
  useApi: (url: string) => (url === "/api/me" ? { data: { user: { id: 2, name: "Fran", role: "finance_manager" } } } : {}),
  Load: ({ url, children }: { url: string | null; children: (d: unknown, reload: () => void) => ReactNode }) => children(DATA[(url ?? "").split("?")[0]], () => {}),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "1" }), usePathname: () => "/payments", useRouter: () => ({ push: () => {} }) }));

import InvoiceDetail from "./invoices/[id]/page";
import Payments from "./payments/page";

const render = (page: ReactNode) => renderToString(page).replaceAll("<!-- -->", ""); // React marks text-node joins in server HTML

test("invoice decision bar: vendor, total, due date, status, top flag with its reason, and named actions", () => {
  const html = render(<InvoiceDetail />);
  const bar = html.slice(html.indexOf('aria-label="Decision"'), html.indexOf('aria-label="Flags"'));
  for (const t of ["Acme Ltd", "1,234.56 CAD", "Due 2026-12-01", "Pending approval", "Blocked: ", "Bank details changed since the last payment", "and 1 more below"]) expect(bar).toContain(t);
  expect(bar).toContain("decision-flag-error"); // the worst flag leads, even though the warning came first
  for (const name of ["Approve invoice INV-1 from Acme Ltd", "Reject invoice INV-1 from Acme Ltd", "Release payment 7 to Acme Ltd"]) expect(bar).toContain(`aria-label="${name}"`);
  expect(html).toContain("flagbox-error");
});

test("approval chain uses names and plain role labels, not ids or raw roles", () => {
  const html = render(<InvoiceDetail />);
  expect(html).toContain("Step 1: Department manager");
  expect(html).toContain("Dana Reyes");
  expect(html).toContain("Delegate for Sam Lee");
  expect(html).toContain("Waiting for Dana Reyes");
  expect(html).toContain("Waiting for CFO"); // no named approver yet: say which role is awaited
  expect(html).not.toContain("dept_manager");
  expect(html).not.toContain("(pending)");
});

test("payments page: each row's Release names the payment and the payee", () => {
  const html = render(<Payments />);
  expect(html).toContain('aria-label="Release payment 7 to Acme Ltd"');
  expect(html).toContain("Acme Ltd"); // vendor column
});

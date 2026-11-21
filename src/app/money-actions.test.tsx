// Page-level checks for the money actions: the decision bar content and the accessible name of every row action.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

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
  "/api/payments/ready": [{ invoiceId: 2, invoiceNumber: "INV-READY", vendorName: "Acme Freight", totalCents: 50000, currency: "CAD", dueDate: "2026-12-05", suggestedMethod: { method: "EFT", label: "EFT", reason: "Vendor's preferred method is EFT" }, earlyPayDiscountCents: null }],
  "/api/vendors/1": { id: 1, name: "Acme Ltd", category: null, status: "active", address: null, province_or_state: null, payment_terms_days: 30, preferred_payment_method: "EFT", bank_account_last4: "1234", bankChanges: [{ id: 1, changed_at: "2026-11-01", changed_by_user_id: 4, request_channel: "email", status: "pending", old_account_last4: "1234", new_account_last4: "9876", verified_by_user_id: null, verified_by_callback: 0, verified_at: null }] },
  "/api/exceptions": [{ id: 1, invoiceNumber: "INV-1", totalCents: 123456, currency: "CAD", flags: [blocking] }],
};
vi.mock("@/components/api", async (orig) => ({
  ...(await orig<typeof import("@/components/api")>()),
  useApi: () => ({}),
  Load: ({ url, children }: { url: string | null; children: (d: unknown, reload: () => void) => ReactNode }) => children(DATA[(url ?? "").split("?")[0]], () => {}),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "1" }), usePathname: () => "/payments", useRouter: () => ({ push: () => {} }) }));

import { asRole } from "@/components/asRole";
import InvoiceDetail from "./invoices/[id]/page";
import Payments from "./payments/page";
import Vendor from "./vendors/[id]/page";
import Exceptions from "./exceptions/page";

const render = (page: ReactNode, role = "finance_manager") => renderToString(asRole(role, page)).replaceAll("<!-- -->", ""); // React marks text-node joins in server HTML

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

// T66: the UI hides what a role can never use (the server still refuses it); a short line says why.
const base = DATA["/api/invoices/1"] as Record<string, unknown>;
const withStatus = (status: string, payments = base.payments) => { DATA["/api/invoices/1"] = { ...base, status, payments }; };
afterEach(() => { DATA["/api/invoices/1"] = base; });

test("auditor sees no action buttons on invoice, vendor or exceptions pages", () => {
  const invoice = render(<InvoiceDetail />, "auditor");
  for (const t of ["Approve invoice", "Reject invoice", "Release payment 7"]) expect(invoice).not.toContain(t);
  expect(invoice).toContain("Only approvers, finance managers and controllers can approve or reject this.");
  expect(invoice).toContain("Only finance managers and controllers can release a payment.");
  withStatus("approved", []);
  const approved = render(<InvoiceDetail />, "auditor");
  expect(approved).not.toContain("Prepare payment");
  expect(approved).toContain("Only AP clerks, finance managers and controllers can prepare a payment.");
  const vendor = render(<Vendor />, "auditor");
  for (const t of ["Callback confirmed", "Callback failed", "Request change", "<form"]) expect(vendor).not.toContain(t);
  expect(vendor).toContain("Only finance managers and controllers can verify a bank change.");
  const ex = render(<Exceptions />, "auditor");
  for (const t of ["Send to approval", "<button class=\"secondary\">Reject"]) expect(ex).not.toContain(t);
  expect(ex).toContain("can resolve this.");
});

test("approver sees Approve and Reject but not Release; finance manager sees everything", () => {
  const approver = render(<InvoiceDetail />, "approver");
  expect(approver).toContain("Approve invoice INV-1");
  expect(approver).toContain("Reject invoice INV-1");
  expect(approver).not.toContain("Release payment 7");
  const fm = render(<InvoiceDetail />, "finance_manager");
  expect(fm).toContain("Approve invoice INV-1");
  expect(fm).toContain("Release payment 7");
  const vendor = render(<Vendor />, "finance_manager");
  for (const t of ["Callback confirmed", "Request change"]) expect(vendor).toContain(t);
  expect(render(<Exceptions />, "ap_clerk")).toContain("Send to approval");
});

test("blocked invoice (needs review) links to Exceptions and names who can resolve it", () => {
  withStatus("needs_review");
  const clerk = render(<InvoiceDetail />, "ap_clerk");
  expect(clerk).toContain('href="/exceptions"');
  expect(clerk).toContain("Resolve in Exceptions");
  expect(clerk).toContain("AP clerks, finance managers and controllers can resolve this.");
  const auditor = render(<InvoiceDetail />, "auditor"); // cannot resolve, so no link to a page that would refuse
  expect(auditor).not.toContain('href="/exceptions"');
  expect(auditor).toContain("AP clerks, finance managers and controllers can resolve this.");
});

// T68: reject and bank-change callbacks go through ConfirmAction (nothing is sent on the first click); Approve and Send to approval are locked single clicks.
test("vendor callbacks name the vendor and both accounts, and sit behind a confirm", () => {
  const html = render(<Vendor />);
  expect(html).toContain('aria-label="Callback confirmed for Acme Ltd, change …1234 to …9876"');
  expect(html).toContain('aria-label="Callback failed for Acme Ltd, reject change to …9876"');
  expect(html).not.toContain("Confirm the callback"); // the step only opens after a click
});

test("exceptions: Reject is confirmed, Send to approval is a locked single click", () => {
  const html = render(<Exceptions />);
  expect(html).toContain('aria-label="Reject invoice INV-1"');
  expect(html).toContain('aria-label="Send invoice INV-1 to approval"');
  expect(html).not.toContain("Confirm rejection");
});

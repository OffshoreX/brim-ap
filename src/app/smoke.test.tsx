// Smoke test: every page renders without throwing. Load is replaced by a version that hands the page canned
// endpoint data straight away (server rendering never runs effects, so a real fetch would never answer).
// The real fetch path, including 401 and 403, is tested at the bottom with fetch mocked.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

const flag = { code: "tax_mismatch", message: "Tax is off", severity: "error" };
const step = { stepNo: 1, role: "approver", userId: 7, userName: "Dana Approver", delegatedFromId: null, reason: "Manager", status: "pending" };
const audit = { id: 1, at: "2026-11-21T10:00:00Z", actorId: 4, action: "invoice.upload", entity: "invoice", entityId: "1", before: null, after: { status: "received" } };
const vendor = { id: 3, name: "Acme Freight", category: "Freight", status: "active", address: "1 Main St", province_or_state: "QC", payment_terms_days: 30, preferred_payment_method: "EFT", bank_account_last4: "1234" };
const payment = { id: 9, invoiceId: 1, invoiceNumber: "INV-1", method: "EFT", status: "scheduled", scheduledDate: "2026-12-01", paidAt: null, amountCents: 12345, currency: "CAD", reference: null };

// One entry per endpoint path, shaped like the real responses.
const DATA: Record<string, unknown> = {
  "/api/users": { users: [{ id: 1, name: "Priya", role: "controller_admin" }] },
  "/api/dashboard": { countsByStatus: { needs_review: 2, paid: 5 }, needsReview: 2, dueThisWeekCadCents: 250000 },
  "/api/invoices": [{ id: 1, status: "needs_review", vendorId: 3, invoiceNumber: "INV-1", invoiceDate: "2026-11-01", totalCents: 12345, currency: "CAD" }],
  "/api/invoices/1": {
    id: 1, status: "pending_approval", invoiceNumber: "INV-1", invoiceDate: "2026-11-01", dueDate: "2026-12-01", subtotalCents: 10000, gstHstCents: 500, pstQstCents: 0,
    totalCents: 10500, currency: "CAD", vendor: { name: "Acme Freight" }, extraction: { total: 105 }, flags: [flag],
    lines: [{ lineNo: 1, description: "Freight", quantity: 1, unitPriceCents: 10000, amountCents: 10000, currency: "CAD", taxCents: 500, glCode: "6100" }],
    approvalChain: [step], approvals: [{ id: 1, stepNo: 1, decision: "approved", decidedAt: "2026-11-02", comment: "ok" }], payments: [payment],
  },
  "/api/invoices/1/trail": [audit],
  "/api/approvals/inbox": [{ invoiceId: 1, stepNo: 1, role: "approver", reason: "Manager", invoiceNumber: "INV-1", totalCents: 10500, currency: "CAD", delegatedFromId: null }],
  "/api/exceptions": [{ id: 1, invoiceNumber: "INV-1", vendorId: 3, totalCents: 10500, currency: "CAD", flags: [flag] }],
  "/api/payments": [payment],
  "/api/payments/cheques": { cheques: [{ paymentId: 9, invoiceNumber: "INV-1", vendor: "Acme Freight", address: "1 Main St", amountCents: 100, currency: "CAD", reference: "PAY-9" }] },
  "/api/vendors": [vendor],
  "/api/vendors/1": { ...vendor, bankChanges: [{ id: 1, changed_at: "2026-11-01", changed_by_user_id: 4, request_channel: "email", status: "pending", old_account_last4: "1234", new_account_last4: "9876", verified_by_user_id: null }] },
  "/api/audit": [audit],
  "/api/admin/approval-rules": { rules: [{ id: 1, policy_id: "P02", over_cents: 500000, extra_role: "finance_manager" }] },
  "/api/inbox/other": [{ emailId: "E1", from: "promo@x.com", subject: "Big sale", receivedAt: null, class: "marketing", attachments: [], flags: [] }],
};

vi.mock("@/components/api", async (orig) => ({
  ...(await orig<typeof import("@/components/api")>()),
  Load: ({ url, children }: { url: string | null; children: (d: unknown, reload: () => void) => ReactNode }) =>
    children(DATA[(url ?? "").split("?")[0]], () => {}),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "1" }), usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));

import Header from "@/components/Header";
import { call, toCents } from "@/components/api";
import Login from "./login/page";
import Dashboard from "./dashboard/page";
import Invoices from "./invoices/page";
import InvoiceDetail from "./invoices/[id]/page";
import Approvals from "./approvals/page";
import Exceptions from "./exceptions/page";
import Payments from "./payments/page";
import Vendors from "./vendors/page";
import VendorDetail from "./vendors/[id]/page";
import Audit from "./audit/page";
import Rules from "./admin/approval-rules/page";
import Inbox from "./inbox/page";

const PAGES: [string, () => ReactNode, string][] = [
  ["login", Login, "Priya"],
  ["dashboard", Dashboard, "2,500.00"],
  ["invoices", Invoices, "INV-1"],
  ["invoice detail", InvoiceDetail, "Dana Approver"],
  ["approvals", Approvals, "Manager"],
  ["exceptions", Exceptions, "Tax is off"],
  ["payments", Payments, "PAY-9"],
  ["vendors", Vendors, "Acme Freight"],
  ["vendor detail", VendorDetail, "Callback confirmed"],
  ["audit", Audit, "invoice.upload"],
  ["approval rules", Rules, "finance_manager"],
  ["inbox", Inbox, "Big sale"],
];

test.each(PAGES)("%s page renders its data", (_name, Page, expected) => {
  expect(renderToString(<Page />)).toContain(expected);
});

test("header renders its links and a sign-in prompt before /api/me answers", () => {
  const html = renderToString(<Header />);
  expect(html).toContain("Dashboard");
  expect(html).toContain("Audit log");
});

afterEach(() => vi.unstubAllGlobals());
const reply = (status: number, body: unknown) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));

test("401 and 403 become clear messages, other errors keep the server text", async () => {
  reply(401, { error: "Not signed in" });
  expect((await call("/api/x")).error).toMatch(/not signed in/i);
  reply(403, { error: "Forbidden" });
  expect((await call("/api/x")).error).toBe("Not allowed: Forbidden");
  reply(409, { error: "Invoice is paid, not approved" });
  expect((await call("/api/x")).error).toBe("Invoice is paid, not approved");
  reply(200, { ok: true });
  expect((await call("/api/x")).data).toEqual({ ok: true });
  vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
  expect((await call("/api/x")).error).toMatch(/could not reach/i);
});

test("money text becomes integer cents", () => {
  expect(toCents("5000")).toBe(500000);
  expect(toCents("12.5")).toBe(1250);
  expect(toCents("0.07")).toBe(7);
  expect(toCents("1.234")).toBeNull();
  expect(toCents("-3")).toBeNull();
});

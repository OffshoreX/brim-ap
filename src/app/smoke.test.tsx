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
  "/api/reconciliation": { summary: { matched: 7, payment_unmatched: 1, payment_ambiguous: 0, amount_diff: 2, duplicate: 0, bank_no_payment: 0, card_no_payment: 0 }, total: 1, rows: [{ category: "matched", paymentId: 9, invoiceNumber: "INV-1", vendor: "Acme Freight", method: "EFT", paymentCents: 12345, lineSource: "bank", lineId: "B1", lineText: "ACME FREIGHT EFT", lineDate: "2026-12-01", lineCents: 12345, diffCents: null, note: "" }] },
  "/api/payments": [payment],
  "/api/payments/cheques": { cheques: [{ paymentId: 9, invoiceNumber: "INV-1", vendor: "Acme Freight", address: "1 Main St", amountCents: 100, currency: "CAD", reference: "PAY-9" }] },
  "/api/vendors": [vendor],
  "/api/vendors/1": { ...vendor, bankChanges: [{ id: 1, changed_at: "2026-11-01", changed_by_user_id: 4, request_channel: "email", status: "pending", old_account_last4: "1234", new_account_last4: "9876", verified_by_user_id: null }] },
  "/api/audit": [audit],
  "/api/reports/aging": [{ bucket: "0-30", invoices: 2, totalCadCents: 123456 }, { bucket: "31-60", invoices: 0, totalCadCents: 0 }, { bucket: "61-90", invoices: 0, totalCadCents: 0 }, { bucket: "90+", invoices: 1, totalCadCents: 5000 }],
  "/api/reports/spend": [{ key: "Acme Freight", invoices: 3, totalCadCents: 987654 }],
  "/api/reports/discounts": [{ vendor: "Acme Freight", terms: "2/10 net 30", takenPayments: 1, takenCadCents: 2000, missedPayments: 2, missedCadCents: 4000 }],
  "/api/admin/approval-rules": { rules: [{ id: 1, policy_id: "P02", over_cents: 500000, extra_role: "finance_manager" }] },
  "/api/inbox/other": [{ emailId: "E1", from: "promo@x.com", subject: "Big sale", receivedAt: null, class: "marketing", attachments: [], flags: [] }],
};

vi.mock("@/components/api", async (orig) => ({
  ...(await orig<typeof import("@/components/api")>()),
  // Only the vendor page asks for exactly "/api/me" (the header adds ?at=), so the header test still sees "not signed in".
  useApi: (url: string) => (url === "/api/me" ? { data: { user: { id: 2, name: "Fran", role: "finance_manager" } } } : {}),
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
import Inbox, { tabOf } from "./inbox/page";
import Upload from "./upload/page";
import Reports from "./reports/page";
import Reconciliation from "./reconciliation/page";
import { groupByCode } from "./exceptions/page";
import { runBatch, type Row } from "@/components/BatchUpload";

const PAGES: [string, () => ReactNode, string][] = [
  ["login", Login, "Password"],
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
  ["inbox", Inbox, "Invoice emails"],
  ["upload", Upload, "Drag invoice files here"],
  ["reports", Reports, "9,876.54"],
  ["reconciliation", Reconciliation, "ACME FREIGHT EFT"],
];

test.each(PAGES)("%s page renders its data", (_name, Page, expected) => {
  expect(renderToString(<Page />)).toContain(expected);
});

test("header shows only a sign-in prompt before /api/me answers (links appear once the role is known)", () => {
  const html = renderToString(<Header />);
  expect(html).toContain("Sign in");
  expect(html).not.toContain("Audit log");
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

test("exceptions group by flag code and the severity filter narrows them", () => {
  const warn = { code: "late_fee", message: "Late fee", severity: "warning" };
  const items = [
    { id: 1, invoiceNumber: "A", totalCents: 1, currency: "CAD", flags: [flag, warn] },
    { id: 2, invoiceNumber: "B", totalCents: 1, currency: "CAD", flags: [flag] },
  ];
  expect(groupByCode(items, "").map((g) => [g.code, g.items.length])).toEqual([["tax_mismatch", 2], ["late_fee", 1]]);
  expect(groupByCode(items, "warning").map((g) => g.code)).toEqual(["late_fee"]);
  expect(groupByCode(items, "info")).toEqual([]);
});

test("inbox classes land on the right tab", () => {
  expect(["invoice", "credit_note", "bank_change", "suspicious", "marketing", "statement"].map(tabOf)).toEqual(
    ["Invoice emails", "Invoice emails", "Bank-change requests", "Suspicious", "Other", "Other"]);
});

// Stands in for the browser's XMLHttpRequest: answers by file name, so one bad file can be told apart.
class FakeXhr {
  upload = { onloadend: () => {} };
  onload = () => {}; onerror = () => {};
  status = 200; responseText = "";
  open() {}
  send(form: FormData) {
    const name = (form.get("file") as File).name;
    this.upload.onloadend();
    if (name === "bad.pdf") { this.status = 400; this.responseText = JSON.stringify({ error: "Not a PDF" }); }
    else if (name === "403.pdf") { this.status = 403; this.responseText = JSON.stringify({ error: "Forbidden" }); }
    else this.responseText = JSON.stringify({ results: [{ file: name, invoiceId: 5, status: "pending_approval", flags: [], error: null, duplicate: name === "again.pdf" }] });
    queueMicrotask(() => this.onload());
  }
}

test("batch upload: a row per file, a failed file does not stop the others, 403 shows the server message", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  const files = ["a.pdf", "bad.pdf", "again.pdf", "403.pdf"].map((n) => new File(["x"], n));
  const rows: Row[] = files.map((f) => ({ name: f.name, state: "queued" }));
  const seen: string[] = [];
  await runBatch(files, (i, patch) => { Object.assign(rows[i], patch); if (patch.state) seen.push(`${i}:${patch.state}`); });
  expect(rows.map((r) => r.state)).toEqual(["done", "failed", "done", "failed"]);
  expect(rows[1].error).toBe("Not a PDF");
  expect(rows[3].error).toBe("Not allowed: Forbidden");
  expect(rows[2].result?.duplicate).toBe(true);
  expect(seen).toContain("0:processing");
});

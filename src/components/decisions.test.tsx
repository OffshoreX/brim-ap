// Tests for the approvals inbox table and the ready-to-pay list (fetch mocked, server rendering only: no effects run).
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/approvals", useRouter: () => ({ push: () => {} }) }));
import { filterInbox, hasErrorFlag, InboxTable, sortInbox, type InboxRow } from "./InboxTable";
import { prepareInvoice, ReadyTable, type ReadyRow } from "./ReadyTable";
import { StatusBadge } from "./ui";

const row = (o: Partial<InboxRow>): InboxRow => ({
  invoiceId: 1, stepNo: 1, role: "approver", reason: "Manager of requester", invoiceNumber: "INV-1", vendorName: "Acme Freight", totalCents: 10500, currency: "CAD",
  dueDate: "2026-12-01", ageDays: 3, delegatedFromId: null, flagCount: 0, topFlag: null, ...o,
});
const err = { code: "tax_mismatch", severity: "error", message: "Tax is off by 5.00" };
const warn = { code: "amount_outlier", severity: "warning", message: "Unusual amount" };
const rows = [
  row({ invoiceId: 1, invoiceNumber: "A", dueDate: "2026-12-09", vendorName: "Zed" }),
  row({ invoiceId: 2, invoiceNumber: "B", dueDate: "2026-12-01", flagCount: 2, topFlag: err }),
  row({ invoiceId: 3, invoiceNumber: "C", dueDate: null, flagCount: 1, topFlag: warn, ageDays: 9 }),
];
const noop = () => {};
const acts = { busyKey: null, locked: false, run: async () => {}, show: () => null } as unknown as Parameters<typeof ReadyTable>[0]["a"];
const html_ = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, ""); // React splits adjacent text nodes with comments

test("inbox shows every decision column and the flag reason in text", () => {
  const html = html_(<InboxTable rows={rows} reload={noop} />);
  for (const t of ["Vendor", "Due", "Age (days)", "Flags", "Why you", "Decision", "Acme Freight", "105.00 CAD", "2 flags", "Tax is off by 5.00", "Approver, step 1: Manager of requester"]) expect(html).toContain(t);
  expect(html).toContain("Sort by");
  expect(html).toContain("Clean (no flags)");
});

test("rows with an error flag say Open to review; others can be approved in place", () => {
  expect(hasErrorFlag(rows[1])).toBe(true);
  expect(hasErrorFlag(rows[2])).toBe(false);
  const html = renderToString(<InboxTable rows={rows} reload={noop} />);
  expect(html.match(/Open to review/g)).toHaveLength(1);
  expect(html.match(/aria-label="Approve /g)).toHaveLength(2);
  expect(html).not.toContain("Confirm approval"); // Approve is one locked click, not a confirm step
});

test("default order is by due date, soonest first, missing dates last", () => {
  expect(sortInbox(rows, "due").map((r) => r.invoiceNumber)).toEqual(["B", "A", "C"]);
  expect(sortInbox(rows, "age").map((r) => r.invoiceNumber)).toEqual(["C", "A", "B"]);
  expect(sortInbox(rows, "vendor")[2].vendorName).toBe("Zed");
  const html = renderToString(<InboxTable rows={rows} reload={noop} />);
  expect(html.indexOf(">B<")).toBeLessThan(html.indexOf(">A<"));
});

test("filter splits flagged from clean", () => {
  expect(filterInbox(rows, "flagged").map((r) => r.invoiceNumber)).toEqual(["B", "C"]);
  expect(filterInbox(rows, "clean").map((r) => r.invoiceNumber)).toEqual(["A"]);
  expect(filterInbox(rows, "all")).toHaveLength(3);
});

test("empty inbox says what to do next", () => {
  expect(renderToString(<InboxTable rows={[]} reload={noop} />)).toContain("Browse all invoices");
});

afterEach(() => vi.unstubAllGlobals());

test("Prepare posts the invoice id and nothing else, so the server picks the method", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 5 }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  expect((await prepareInvoice(42, "k1")).error).toBeUndefined();
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/payments/prepare");
  expect(JSON.parse(String(init.body))).toEqual({ invoiceId: 42 });
  expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("k1");
});

test("ready list shows vendor, method with its reason, discount and a Prepare button per row", () => {
  const ready: ReadyRow[] = [{ invoiceId: 7, invoiceNumber: "INV-7", vendorName: "Acme Freight", totalCents: 50000, currency: "CAD", dueDate: "2026-12-05",
    suggestedMethod: { method: "CHEQUE", label: "Cheque", reason: "Vendor does not accept card" }, earlyPayDiscountCents: 1000 }];
  const html = renderToString(<ReadyTable rows={ready} a={acts} />);
  for (const t of ["Acme Freight", "INV-7", "500.00 CAD", "2026-12-05", "Cheque", "Vendor does not accept card", "10.00 CAD", "Prepare payment for INV-7"]) expect(html).toContain(t);
  expect(renderToString(<ReadyTable rows={[]} a={acts} />)).toContain("Nothing is ready to pay");
});

test("an unknown payment status gets a neutral badge with its plain label, never the raw token", () => {
  const html = renderToString(<StatusBadge status="part_settled" label="Part settled" />);
  expect(html).toContain("badge-unknown");
  expect(html).toContain("Part settled");
  expect(html).not.toContain("part_settled");
  expect(renderToString(<StatusBadge status="settled" label="Paid" />)).toContain("badge-paid");
});

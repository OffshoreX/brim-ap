// Reports UI tests (server rendering, fetch mocked where a call is made): chart text, CSV links, loading, empty and 403 states.
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

let role = "finance_manager";
let payload: unknown = [];
vi.mock("@/components/api", async (orig) => ({
  ...(await orig<typeof import("@/components/api")>()),
  useApi: () => ({ data: { user: { id: 1, name: "T", role } } }),
  Load: ({ children }: { children: (d: unknown, r: () => void) => unknown }) => children(payload, () => {}),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/reports", useRouter: () => ({ push: () => {} }) }));

import { BarChart } from "./Charts";
import DashboardCharts, { AgingPanel, TopVendors } from "./ReportCharts";
import { Flags, call } from "./api";
import Reports from "@/app/reports/page";
import { linksFor } from "./Header";

afterEach(() => { role = "finance_manager"; payload = []; vi.unstubAllGlobals(); });

test("bar chart shows labelled axes, money from cents and each value as text", () => {
  const html = renderToString(<BarChart title="Spend" categoryLabel="Vendor" series={[{ name: "Total", color: "#000" }]} rows={[{ label: "Acme", values: [123456] }, { label: "Zed", values: [5000] }]} />);
  for (const t of ["Vendor", "Amount (CAD)", "1,234.56", "50.00", "Acme", "Zed"]) expect(html).toContain(t);
});

test("two series get a legend that names them", () => {
  const html = renderToString(<BarChart title="D" categoryLabel="Vendor" series={[{ name: "Taken", color: "#0a0" }, { name: "Missed", color: "#f80" }]} rows={[{ label: "A", values: [1, 2] }]} />);
  expect(html).toContain("Taken");
  expect(html).toContain("Missed");
});

test("reports page lists every section with a ?format=csv link", () => {
  const html = renderToString(<Reports />);
  for (const h of ["AP aging", "Spend by vendor", "Spend by department", "Spend by month", "Discounts taken versus missed"]) expect(html).toContain(h);
  expect(html.match(/format=csv/g)).toHaveLength(5);
});

test("roles outside finance_manager, controller_admin and auditor see a not-allowed message and no report", () => {
  role = "employee";
  const html = renderToString(<Reports />);
  expect(html).toContain("Not allowed");
  expect(html).not.toContain("AP aging");
  expect(renderToString(<DashboardCharts />)).toBe("");
});

test("empty reports say so instead of drawing an empty chart", () => {
  payload = [];
  expect(renderToString(<TopVendors />)).toContain("No approved or paid spend yet");
  payload = [{ bucket: "0-30", invoices: 0, totalCadCents: 0 }];
  expect(renderToString(<AgingPanel />)).toContain("No open invoices are past due");
});

test("dashboard shows the aging and top vendors blocks for a report role", () => {
  payload = [{ bucket: "90+", key: "Acme", invoices: 1, totalCadCents: 5000 }]; // one stub feeds both blocks
  const html = renderToString(<DashboardCharts />);
  expect(html).toContain("AP aging");
  expect(html).toContain("Top vendors by spend");
});

test("a 403 from a report endpoint becomes the server's message", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
  expect((await call("/api/reports/aging")).error).toBe("Not allowed: Forbidden");
});

test("budget and outlier flags show a plain name and the server's reason", () => {
  const html = renderToString(<Flags flags={[
    { code: "department_over_budget", severity: "warning", message: "Department spend is 120% of budget" },
    { code: "amount_outlier", severity: "warning", message: "3.1x the vendor median" },
  ]} />);
  for (const t of ["Department over budget", "120% of budget", "Unusual amount for this vendor", "3.1x the vendor median"]) expect(html).toContain(t);
});

test("Reports link is only for the three report roles", () => {
  const has = (r: Parameters<typeof linksFor>[0]) => linksFor(r).some(([h]) => h === "/reports");
  expect([has("finance_manager"), has("controller_admin"), has("auditor"), has("employee"), has("approver")]).toEqual([true, true, true, false, false]);
});

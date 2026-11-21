// Dashboard cleanup tests (server rendering, API hooks mocked): one counter source, status links, recon error, chart rules.
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

let role = "controller_admin";
let recon: { data?: unknown; error?: string } = {};
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));
vi.mock("@/components/api", async (orig) => ({
  ...(await orig<typeof import("@/components/api")>()),
  useApi: (url: string | null) => (url === "/api/me" ? { data: { user: { id: 1, name: "T", role } } } : url?.startsWith("/api/reconciliation") ? recon : {}),
  // Only the dashboard call is answered; chart panels stay out of these tests.
  Load: ({ url, children }: { url: string; children: (d: unknown, r: () => void) => unknown }) =>
    url === "/api/dashboard" ? children({ countsByStatus: { needs_review: 2, part_paid: 1 } }, () => {}) : null,
}));

import Dashboard from "@/app/dashboard/page";
import { BarChart, wrap } from "./Charts";
import ReconCard from "./ReconCard";
import { StatusBadge } from "./ui";

const css = readFileSync(new URL("../app/ui.css", import.meta.url), "utf8");

test("each headline number appears once: RoleHome is the only counter source on the dashboard", () => {
  const html = renderToString(<Dashboard />);
  expect(html.match(/Due this week/g)).toHaveLength(1);
  expect(html.match(/>Needs review</g)).toHaveLength(2); // the home counter and the status badge in the table, nothing else
  expect(html).toContain("Invoices whose status is Needs review"); // the plain line saying what the counter counts
});

test("status rows link to the invoice list filtered by that status", () => {
  const html = renderToString(<Dashboard />);
  expect(html).toContain('href="/invoices?status=needs_review"');
  expect(html).toContain('href="/invoices?status=part_paid"');
});

test("an unknown status shows a plain grey label, never the raw token", () => {
  const html = renderToString(<StatusBadge status="part_paid" />);
  expect(html).toContain("Part paid");
  expect(html).toContain("badge-unknown");
  expect(html).not.toContain("part_paid");
});

test("reconciliation card names the failing endpoint instead of rendering nothing", () => {
  role = "auditor";
  recon = { error: "Request failed (500)" };
  const html = renderToString(<ReconCard />);
  expect(html).toContain("GET /api/reconciliation");
  expect(html).toContain("Request failed (500)");
  expect(html).toContain('role="alert"');
});

test("reconciliation card is one card with one link", () => {
  role = "auditor";
  recon = { data: { summary: { matched: 5, payment_unmatched: 1, payment_ambiguous: 0, amount_diff: 2, duplicate: 0, bank_no_payment: 0, card_no_payment: 0 } } };
  expect(renderToString(<ReconCard />).match(/<a /g)).toHaveLength(1);
});

test("chart SVG has no <title> tooltip and shows the full vendor name, wrapped", () => {
  const long = "Northern Lights Freight and Logistics Holdings Ltd";
  const html = renderToString(<BarChart title="Spend" categoryLabel="Vendor" series={[{ name: "Total", color: "var(--chart-total)" }]} rows={[{ label: long, values: [5000] }]} />);
  expect(html).not.toContain("<title");
  expect(html).not.toContain("…");
  expect(wrap(long).join(" ")).toBe(long);
  expect(html).toContain("50.00 CAD"); // money ticks carry the currency
});

test("ui.css: chart tokens, bar-grow of 250ms and the reduced-motion guard are present", () => {
  for (const t of ["--chart-total", "--chart-taken", "--chart-missed"]) expect(css).toMatch(new RegExp(`${t}:#[0-9a-f]{6}`));
  expect(css).toMatch(/\.chart \.bar \{[^}]*animation: bar-grow 250ms ease-out/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.chart \.bar \{ animation: none; \} \}/);
  expect(css).toMatch(/\.chart \.tick \{/);
  expect(css).toMatch(/\.chart \.cat \{/);
});

"use client";
import type { MeResponse } from "@/contracts";
import { Load, money, useApi } from "./api";
import { BarChart, ReportSection } from "./Charts";
import { Empty, Table } from "./ui";

// Shapes of the T46 report endpoints (src/server/reports.ts).
export type AgingRow = { bucket: string; invoices: number; totalCadCents: number };
export type SpendRow = { key: string; invoices: number; totalCadCents: number };
export type DiscountRow = { vendor: string; terms: string; takenPayments: number; takenCadCents: number; missedPayments: number; missedCadCents: number };
// Same roles as REPORT_ROLES on the server; the server still answers 403 for anyone else.
export const REPORT_ROLES = ["finance_manager", "controller_admin", "auditor"];

const BLUE = { name: "Total", color: "#2563eb" };
const GREEN = { name: "Taken", color: "#059669" };
const ORANGE = { name: "Missed", color: "#d97706" };

export function AgingPanel() {
  return (
    <Load<AgingRow[]> url="/api/reports/aging">
      {(rows) => rows.every((r) => r.invoices === 0) ? <Empty>No open invoices are past due.</Empty> : (
        <>
          <BarChart title="Past-due open invoices by days overdue" categoryLabel="Days past due" series={[BLUE]} rows={rows.map((r) => ({ label: `${r.bucket} days`, values: [r.totalCadCents] }))} />
          <Table>
            <thead><tr><th>Days past due</th><th className="num">Invoices</th><th className="num">Total (CAD)</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.bucket}><td>{r.bucket}</td><td className="num">{r.invoices}</td><td className="num">{money(r.totalCadCents)}</td></tr>)}</tbody>
          </Table>
        </>
      )}
    </Load>
  );
}

// The server sorts biggest first; `limit` keeps the dashboard to the top few.
export function TopVendors({ limit = 5 }: { limit?: number }) {
  return (
    <Load<SpendRow[]> url={`/api/reports/spend?by=vendor&limit=${limit}`}>
      {(rows) => rows.length === 0 ? <Empty>No approved or paid spend yet.</Empty> : (
        <BarChart title={`Top ${limit} vendors by spend`} categoryLabel="Vendor" series={[BLUE]} rows={rows.map((r) => ({ label: r.key, values: [r.totalCadCents] }))} />
      )}
    </Load>
  );
}

export function SpendPanel({ by }: { by: "vendor" | "department" | "month" }) {
  return (
    <Load<SpendRow[]> url={`/api/reports/spend?by=${by}&limit=200`}>
      {(rows) => {
        if (rows.length === 0) return <Empty>No approved or paid spend yet.</Empty>;
        const shown = by === "month" ? [...rows].sort((a, b) => a.key.localeCompare(b.key)) : rows; // months read oldest first
        return (
          <>
            <BarChart title={`Spend by ${by}${by === "vendor" ? " (top 10)" : ""}`} categoryLabel={by[0].toUpperCase() + by.slice(1)} series={[BLUE]}
              rows={(by === "vendor" ? shown.slice(0, 10) : shown).map((r) => ({ label: r.key, values: [r.totalCadCents] }))} />
            <Table>
              <thead><tr><th>{by[0].toUpperCase() + by.slice(1)}</th><th className="num">Invoices</th><th className="num">Total (CAD)</th></tr></thead>
              <tbody>{shown.map((r) => <tr key={r.key}><td>{r.key}</td><td className="num">{r.invoices}</td><td className="num">{money(r.totalCadCents)}</td></tr>)}</tbody>
            </Table>
            {rows.length === 200 && <p className="muted">The table shows the first 200 rows; the CSV has everything.</p>}
          </>
        );
      }}
    </Load>
  );
}

export function DiscountsPanel() {
  return (
    <Load<DiscountRow[]> url="/api/reports/discounts">
      {(rows) => rows.length === 0 ? <Empty>No vendor has early-payment terms.</Empty> : (
        <>
          <BarChart title="Early-payment discounts: taken versus missed" categoryLabel="Vendor" series={[GREEN, ORANGE]} rows={rows.map((r) => ({ label: r.vendor, values: [r.takenCadCents, r.missedCadCents] }))} />
          <Table>
            <thead><tr><th>Vendor</th><th>Terms</th><th className="num">Taken (payments)</th><th className="num">Taken (CAD)</th><th className="num">Missed (payments)</th><th className="num">Missed (CAD)</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.vendor}><td>{r.vendor}</td><td>{r.terms}</td><td className="num">{r.takenPayments}</td><td className="num">{money(r.takenCadCents)}</td><td className="num">{r.missedPayments}</td><td className="num">{money(r.missedCadCents)}</td></tr>)}</tbody>
          </Table>
        </>
      )}
    </Load>
  );
}

// Dashboard add-on: only asks for the reports when the role may read them (display only; the server still decides).
export default function DashboardCharts() {
  const { data } = useApi<MeResponse>("/api/me");
  if (!data || !REPORT_ROLES.includes(data.user.role)) return null;
  return (
    <div className="charts">
      <ReportSection title="AP aging" csv={{ href: "/api/reports/aging?format=csv", filename: "aging.csv" }}><AgingPanel /></ReportSection>
      <ReportSection title="Top vendors by spend" csv={{ href: "/api/reports/spend?by=vendor&format=csv", filename: "spend-by-vendor.csv" }}><TopVendors /></ReportSection>
    </div>
  );
}

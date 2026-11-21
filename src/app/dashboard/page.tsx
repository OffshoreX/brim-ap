"use client";
import { StatusBadge, Table } from "@/components/ui";
import Link from "next/link";
import { Load } from "@/components/api";
import { STATUS_LABEL } from "@/components/ui";
import RoleHome from "@/components/RoleHome";
import DashboardCharts from "@/components/ReportCharts";
import ReconCard from "@/components/ReconCard";

// The headline counters live only in RoleHome; this page adds the per-status table and the charts.
type Dash = { countsByStatus: Record<string, number> };

// GET /api/dashboard
export default function DashboardPage() {
  return (
    <main id="main">
      <h1>Dashboard</h1>
      <RoleHome page="/dashboard" />
      <Load<Dash> url="/api/dashboard">
        {(d) => (
          <>
            <ReconCard />
            <DashboardCharts />
            <Table>
              <thead><tr><th>Status</th><th className="num">Invoices</th></tr></thead>
              <tbody>
                {Object.entries(d.countsByStatus).map(([s, n]) => <tr key={s}><td><Link href={`/invoices?status=${s}`} aria-label={`${n} invoices with status ${STATUS_LABEL[s] ?? s}: show them`}><StatusBadge status={s} /></Link></td><td className="num">{n}</td></tr>)}
              </tbody>
            </Table>
          </>
        )}
      </Load>
    </main>
  );
}

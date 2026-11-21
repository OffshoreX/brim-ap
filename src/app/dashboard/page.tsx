"use client";
import { StatusBadge, Table } from "@/components/ui";
import { Load, money } from "@/components/api";
import RoleHome from "@/components/RoleHome";

type Dash = { countsByStatus: Record<string, number>; needsReview: number; dueThisWeekCadCents: number };

// GET /api/dashboard
export default function DashboardPage() {
  return (
    <main>
      <h1>Dashboard</h1>
      <RoleHome page="/dashboard" />
      <Load<Dash> url="/api/dashboard">
        {(d) => (
          <>
            <div className="cards">
              <div className="card">Needs review<strong>{d.needsReview}</strong></div>
              <div className="card">Due this week<strong>{money(d.dueThisWeekCadCents, "CAD")}</strong></div>
            </div>
            <Table>
              <thead><tr><th>Status</th><th className="num">Invoices</th></tr></thead>
              <tbody>
                {Object.entries(d.countsByStatus).map(([s, n]) => <tr key={s}><td><StatusBadge status={s} /></td><td className="num">{n}</td></tr>)}
              </tbody>
            </Table>
          </>
        )}
      </Load>
    </main>
  );
}

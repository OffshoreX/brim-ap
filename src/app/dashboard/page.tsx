"use client";
import { Load, money } from "@/components/api";

type Dash = { countsByStatus: Record<string, number>; needsReview: number; dueThisWeekCadCents: number };

// GET /api/dashboard
export default function DashboardPage() {
  return (
    <main>
      <h1>Dashboard</h1>
      <Load<Dash> url="/api/dashboard">
        {(d) => (
          <>
            <p>Needs review: <strong>{d.needsReview}</strong></p>
            <p>Due this week: <strong>{money(d.dueThisWeekCadCents, "CAD")}</strong></p>
            <table>
              <thead><tr><th>Status</th><th className="num">Invoices</th></tr></thead>
              <tbody>
                {Object.entries(d.countsByStatus).map(([s, n]) => <tr key={s}><td>{s}</td><td className="num">{n}</td></tr>)}
              </tbody>
            </table>
          </>
        )}
      </Load>
    </main>
  );
}

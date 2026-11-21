"use client";
import { Skeleton } from "@/components/ui";
import { useCurrentUser } from "@/components/CurrentUser";
import { ReportSection } from "@/components/Charts";
import { AgingPanel, DiscountsPanel, REPORT_ROLES, SpendPanel } from "@/components/ReportCharts";

const csv = (path: string, filename: string) => ({ href: `/api/reports/${path}${path.includes("?") ? "&" : "?"}format=csv`, filename });

// GET /api/reports/aging, /spend?by=vendor|department|month, /discounts. All amounts are CAD cents from SQL aggregates.
export default function ReportsPage() {
  const { role, error } = useCurrentUser();
  return (
    <main id="main">
      <h1>Reports</h1>
      {error ? <p role="alert" className="error-box">{error}</p>
        : !role ? <Skeleton />
        : !REPORT_ROLES.includes(role) ? <p role="alert" className="error-box">Not allowed: reports are for finance managers, controllers and auditors.</p>
        : (
          <>
            <ReportSection title="AP aging" csv={csv("aging", "aging.csv")}><AgingPanel /></ReportSection>
            <ReportSection title="Spend by vendor" csv={csv("spend?by=vendor", "spend-by-vendor.csv")}><SpendPanel by="vendor" /></ReportSection>
            <ReportSection title="Spend by department" csv={csv("spend?by=department", "spend-by-department.csv")}><SpendPanel by="department" /></ReportSection>
            <ReportSection title="Spend by month" csv={csv("spend?by=month", "spend-by-month.csv")}><SpendPanel by="month" /></ReportSection>
            <ReportSection title="Discounts taken versus missed" csv={csv("discounts", "discounts.csv")}><DiscountsPanel /></ReportSection>
          </>
        )}
    </main>
  );
}

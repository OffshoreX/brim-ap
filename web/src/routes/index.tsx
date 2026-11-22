import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatCard } from "@/components/StatCard";
import { BarChart } from "@/components/BarChart";
import { QueryView, Empty } from "@/components/States";
import { ProcessSteps } from "@/components/ProcessSteps";
import { Money } from "@/components/Money";
import { useAging, useDashboard, useInvoiceCounts, useProcessLog, useSpend } from "@/hooks/queries";
import { can } from "@/lib/roles";
import { plural } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { InvoiceStatus, Me } from "@/lib/types";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => pageHead("Home", "Invoice counts, money due this week, aging and vendor spend at a glance."),
  component: () => <AppShell>{(me) => <Dashboard me={me} />}</AppShell>,
});

// "blocked" is not a status the server has, so there is no card for it; flagged invoices show up under Needs review.
const CARDS: { label: string; status: InvoiceStatus | undefined }[] = [
  { label: "All invoices", status: undefined },
  { label: "Needs review", status: "needs_review" },
  { label: "Pending approval", status: "pending_approval" },
  { label: "Approved", status: "approved" },
  { label: "Scheduled", status: "scheduled" },
  { label: "Paid", status: "paid" },
];

function Dashboard({ me }: { me: Me }) {
  // Counts come from /api/invoices/counts; "Needs review" and "due this week" come from /api/dashboard.
  // Both are limited by the server to the invoices this role may see (an employee gets only their own).
  const counts = useInvoiceCounts();
  const dash = useDashboard();
  const showReports = can(me.role, "reports");
  const aging = useAging(showReports);
  const spend = useSpend("vendor", showReports);
  const showActivity = can(me.role, "activity");
  const activity = useProcessLog(8, showActivity);

  return (
    <>
      <PageHeader title={`Good to see you, ${me.name.split(" ")[0]}`} subtitle={me.role === "employee" ? "Here's where the invoices you submitted stand today." : "Here's where accounts payable stands today."} />
      <QueryView q={counts}>
        {(c) => (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {CARDS.map((card) => (
              <StatCard key={card.label} label={card.label} status={card.status}
                value={card.status === undefined ? c.total : card.status === "needs_review" ? dash.data?.needsReview ?? c.byStatus.needs_review : c.byStatus[card.status]} />
            ))}
          </div>
        )}
      </QueryView>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel title="Due this week">
          <QueryView q={dash}>
            {(d) => (
              <div className="space-y-1">
                <Money cents={d.dueThisWeekCadCents} currency="CAD" className="text-3xl font-bold" />
                <p className="text-sm text-muted-foreground">Unpaid invoices due in the next 7 days, converted to CAD.</p>
              </div>
            )}
          </QueryView>
        </Panel>
        {showActivity && (
          <Panel title="Recent activity" className="lg:col-span-2" actions={<Link to="/activity" className="text-sm font-semibold text-primary hover:underline">View all</Link>}>
            <QueryView q={activity}>
              {(a) => a.length ? <ProcessSteps steps={a} showTime /> : <Empty title="No activity yet" to="/upload" linkLabel="Upload an invoice" />}
            </QueryView>
          </Panel>
        )}
      </div>

      {showReports && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel title="Past-due payables by age">
            <QueryView q={aging}>
              {(a) => a.buckets.some((b) => b.count > 0) ? <BarChart currency={a.currency} rows={a.buckets.map((b) => ({ label: b.label, cents: b.amountCents, note: plural(b.count, "invoice") }))} /> : <Empty title="Nothing past due" />}
            </QueryView>
          </Panel>
          <Panel title="Spend by vendor">
            <QueryView q={spend}>
              {(s) => s.rows.length ? <BarChart currency={s.currency} rows={s.rows.map((r) => ({ label: r.label, cents: r.amountCents }))} /> : <Empty title="No spend yet" />}
            </QueryView>
          </Panel>
        </div>
      )}
    </>
  );
}

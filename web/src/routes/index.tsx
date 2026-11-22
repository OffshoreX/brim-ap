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
import { plural, formatDateTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { Me } from "@/lib/types";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => pageHead("Home", "Invoice counts, aging, vendor spend and reconciliation at a glance."),
  component: () => <AppShell>{(me) => <Dashboard me={me} />}</AppShell>,
});

const CARDS = [
  { label: "All invoices", status: undefined },
  { label: "Needs review", status: "needs_review" },
  { label: "Pending approval", status: "pending_approval" },
  { label: "Blocked", status: "blocked" },
  { label: "Approved", status: "approved" },
  { label: "Scheduled", status: "scheduled" },
] as const;

function Dashboard({ me }: { me: Me }) {
  const counts = useInvoiceCounts();
  const aging = useAging();
  const spend = useSpend();
  const dash = useDashboard();
  const showActivity = can(me.role, "activity");
  const activity = useProcessLog(8, showActivity);

  return (
    <>
      <PageHeader title={`Good to see you, ${me.name.split(" ")[0]}`} subtitle="Here's where accounts payable stands today." />
      <QueryView q={counts}>
        {(c) => (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {CARDS.map((card) => (
              <StatCard key={card.label} label={card.label} status={card.status} value={card.status ? c.byStatus[card.status] ?? 0 : c.total} />
            ))}
          </div>
        )}
      </QueryView>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Aging of open payables">
          <QueryView q={aging}>
            {(a) => a.buckets.length ? <BarChart currency={a.currency} rows={a.buckets.map((b) => ({ label: b.label, cents: b.amountCents, note: plural(b.count, "invoice") }))} /> : <Empty title="Nothing outstanding" />}
          </QueryView>
        </Panel>
        <Panel title="Spend by vendor">
          <QueryView q={spend}>
            {(s) => s.rows.length ? <BarChart currency={s.currency} rows={s.rows.map((r) => ({ label: r.vendorName, cents: r.amountCents }))} /> : <Empty title="No spend yet" />}
          </QueryView>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel title="Reconciliation" className="lg:col-span-1">
          <QueryView q={dash}>
            {(d) => {
              const r = d.reconciliation;
              return (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">{r.periodLabel} · last run {formatDateTime(r.lastRunAt)}</p>
                  <dl className="grid grid-cols-2 gap-4">
                    <div><dt className="text-sm text-muted-foreground">Matched</dt><dd className="num text-2xl font-bold">{r.matchedCount}</dd><Money cents={r.matchedCents} currency={r.currency} className="text-sm text-muted-foreground" /></div>
                    <div><dt className="text-sm text-muted-foreground">Unmatched</dt><dd className="num text-2xl font-bold text-bad-foreground">{r.unmatchedCount}</dd><Money cents={r.unmatchedCents} currency={r.currency} className="text-sm text-muted-foreground" /></div>
                  </dl>
                  {can(me.role, "reconciliation") && <Link to="/reconciliation" className="text-sm font-semibold text-primary hover:underline">Open reconciliation →</Link>}
                </div>
              );
            }}
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
    </>
  );
}

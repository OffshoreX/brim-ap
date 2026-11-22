import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { QueryView, Forbidden } from "@/components/States";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { useAction, useReconciliation } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDateTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { Me } from "@/lib/types";

export const Route = createFileRoute("/reconciliation")({
  ssr: false,
  head: () => pageHead("Reconciliation", "Match Brim card and bank activity to paid invoices."),
  component: () => <AppShell>{(me) => (can(me.role, "reconciliation") ? <ReconPage me={me} /> : <Forbidden />)}</AppShell>,
});

function ReconPage({ me }: { me: Me }) {
  const q = useReconciliation();
  // POST /api/reconciliation
  const run = useAction(() => api.runReconciliation(), [["reconciliation"], ["dashboard"]]);
  return (
    <>
      <PageHeader title="Reconciliation" subtitle="Payments matched against bank and card statements."
        actions={me.role !== "auditor" && <Button disabled={run.isPending} onClick={() => run.mutateAsync(undefined).then(() => toast.success("Reconciliation finished")).catch((e: Error) => toast.error(e.message))}>{run.isPending ? "Running…" : "Run reconciliation"}</Button>} />
      <QueryView q={q}>
        {(r) => (
          <div className="grid gap-4 md:grid-cols-3">
            <Panel title="Period"><p className="text-2xl font-bold">{r.periodLabel}</p><p className="text-sm text-muted-foreground">Last run {formatDateTime(r.lastRunAt)}</p></Panel>
            <Panel title="Matched"><p className="num text-4xl font-bold">{r.matchedCount}</p><Money cents={r.matchedCents} currency={r.currency} className="text-muted-foreground" /></Panel>
            <Panel title="Unmatched"><p className="num text-4xl font-bold text-bad-foreground">{r.unmatchedCount}</p><Money cents={r.unmatchedCents} currency={r.currency} className="text-muted-foreground" /></Panel>
          </div>
        )}
      </QueryView>
    </>
  );
}

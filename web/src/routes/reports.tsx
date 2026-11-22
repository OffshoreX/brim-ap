import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { BarChart } from "@/components/BarChart";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { useAging, useDiscounts, useSpend } from "@/hooks/queries";
import { downloadUrl } from "@/lib/api";
import { can } from "@/lib/roles";
import { plural } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { SPEND_BY, type SpendBy } from "@/lib/types";

export const Route = createFileRoute("/reports")({
  ssr: false,
  head: () => pageHead("Reports", "Aging, spend and early-payment discounts."),
  component: () => <AppShell>{(me) => (can(me.role, "reports") ? <ReportsPage /> : <Forbidden />)}</AppShell>,
});

const csv = (path: string) => (
  <Button variant="outline" size="sm" asChild><a href={downloadUrl(path)} download><Download aria-hidden />CSV</a></Button>
);

function ReportsPage() {
  const [by, setBy] = useState<SpendBy>("vendor");
  const aging = useAging();
  const spend = useSpend(by);
  const disc = useDiscounts();
  return (
    <>
      <PageHeader title="Reports" subtitle="Where the money is and where it's going. All amounts are CAD." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Aging (open invoices past due)" actions={csv("/reports/aging?format=csv")}>
          <QueryView q={aging}>{(a) => a.buckets.every((b) => b.count === 0) ? <Empty title="Nothing past due" /> : <BarChart currency={a.currency} rows={a.buckets.map((b) => ({ label: b.label, cents: b.amountCents, note: plural(b.count, "invoice") }))} />}</QueryView>
        </Panel>
        <Panel title={`Spend by ${by}`} actions={csv(`/reports/spend?by=${by}&format=csv`)}>
          <div className="mb-4 flex gap-2" role="group" aria-label="Group spend by">
            {SPEND_BY.map((k) => <Button key={k} size="sm" variant={k === by ? "default" : "outline"} aria-pressed={k === by} onClick={() => setBy(k)}>{k}</Button>)}
          </div>
          <QueryView q={spend}>{(s) => s.rows.length ? (
            <>
              <BarChart currency={s.currency} rows={s.rows.map((r) => ({ label: r.label, cents: r.amountCents, note: plural(r.count, "invoice") }))} />
              {s.total > s.rows.length && <p className="mt-3 text-xs text-muted-foreground">Top {s.rows.length} of {s.total}. The CSV has all of them.</p>}
            </>
          ) : <Empty title="No spend yet" />}</QueryView>
        </Panel>
      </div>
      <div className="mt-10 mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Early-payment discounts</h2>
        {csv("/reports/discounts?format=csv")}
      </div>
      <QueryView q={disc}>
        {(rows) => rows.length === 0 ? <Empty title="No vendors offer early-payment discounts" /> : (
          <Table>
            <thead><tr><Th>Vendor</Th><Th>Terms</Th><Th right>Taken</Th><Th right>Discount taken</Th><Th right>Missed</Th><Th right>Discount missed</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.vendor}>
                <Td className="font-semibold">{r.vendor}</Td><Td>{r.terms}</Td>
                <Td right>{r.takenPayments}</Td><Td right><Money cents={r.takenCadCents} currency="CAD" /></Td>
                <Td right>{r.missedPayments}</Td><Td right><Money cents={r.missedCadCents} currency="CAD" /></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

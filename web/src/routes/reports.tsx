import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { BarChart } from "@/components/BarChart";
import { QueryView, Empty } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { Money } from "@/components/Money";
import { StatusPill } from "@/components/StatusPill";
import { useAging, useDiscounts, useSpend } from "@/hooks/queries";
import { plural, formatDate } from "@/lib/format";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/reports")({
  ssr: false,
  head: () => pageHead("Reports", "Aging, vendor spend and early-payment discounts."),
  component: () => <AppShell>{() => <ReportsPage />}</AppShell>,
});

function ReportsPage() {
  const aging = useAging();
  const spend = useSpend();
  const disc = useDiscounts();
  return (
    <>
      <PageHeader title="Reports" subtitle="Where the money is and where it's going." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Aging"><QueryView q={aging}>{(a) => a.buckets.length ? <BarChart currency={a.currency} rows={a.buckets.map((b) => ({ label: b.label, cents: b.amountCents, note: plural(b.count, "invoice") }))} /> : <Empty title="Nothing outstanding" />}</QueryView></Panel>
        <Panel title="Spend by vendor"><QueryView q={spend}>{(s) => s.rows.length ? <BarChart currency={s.currency} rows={s.rows.map((r) => ({ label: r.vendorName, cents: r.amountCents }))} /> : <Empty title="No spend yet" />}</QueryView></Panel>
      </div>
      <h2 className="mt-10 mb-3 text-xl font-bold">Early-payment discounts</h2>
      <QueryView q={disc}>
        {(d) => d.rows.length === 0 ? <Empty title="No discounts available" /> : (
          <Table>
            <thead><tr><Th>Invoice</Th><Th>Vendor</Th><Th>Pay by</Th><Th>Outcome</Th><Th right>Discount</Th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.invoiceNumber}><Td className="font-semibold">{r.invoiceNumber}</Td><Td>{r.vendorName}</Td><Td className="num">{formatDate(r.deadline)}</Td><Td><StatusPill status={r.captured ? "approved" : "pending"} /></Td><Td right><Money cents={r.discountCents} currency={d.currency} /></Td></tr>)}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

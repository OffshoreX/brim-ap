import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { notify } from "@/lib/notify";
import { Download } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { Money } from "@/components/Money";
import { StatusPill } from "@/components/StatusPill";
import { ConfirmInline } from "@/components/ConfirmInline";
import { Pager } from "@/components/Pager";
import { Button } from "@/components/ui/button";
import { useAction, usePayments, useReadyToPay } from "@/hooks/queries";
import { api, downloadUrl, errorText } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDate, formatMoney, NOT_READ_YET } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { Me, Payment, ReadyToPay } from "@/lib/types";

export const Route = createFileRoute("/payments")({
  ssr: false,
  head: () => pageHead("Payments", "Schedule, release and download Harborline vendor payments."),
  component: () => <AppShell>{(me) => (can(me.role, "payments") ? <PaymentsPage me={me} /> : <Forbidden />)}</AppShell>,
});

const LIMIT = 25;
const REFRESH = [["payments"], ["invoices"], ["invoice-counts"], ["dashboard"]];

function PaymentsPage({ me }: { me: Me }) {
  const canSchedule = can(me.role, "prepare");
  const [readyAt, setReadyAt] = useState(0);
  const [allAt, setAllAt] = useState(0);
  const ready = useReadyToPay({ limit: LIMIT, offset: readyAt }, canSchedule);
  const payments = usePayments({ limit: LIMIT, offset: allAt });
  return (
    <>
      <PageHeader title="Payments" subtitle="Approved invoices ready to pay, and every payment already scheduled or settled (oldest first)."
        actions={can(me.role, "downloads") && (
          <>
            {/* GET /api/payments/eft-file is a CSV and /api/payments/cheques is JSON; neither names its file, so the link does. */}
            <Button variant="outline" asChild><a href={downloadUrl("/payments/eft-file")} download="eft-file.csv"><Download aria-hidden />EFT file</a></Button>
            <Button variant="outline" asChild><a href={downloadUrl("/payments/cheques")} download="cheques.json"><Download aria-hidden />Cheques</a></Button>
          </>
        )} />
      {canSchedule && (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-bold">Ready to pay</h2>
          <QueryView q={ready}>
            {(d) => d.total === 0 ? <Empty title="Nothing ready to pay" to="/approvals" linkLabel="Check approvals">Approved invoices appear here.</Empty> : (
              <>
                <Table>
                  <thead><tr><Th>Invoice</Th><Th>Vendor</Th><Th>Due</Th><Th>Method</Th><Th right>Amount</Th><Th /></tr></thead>
                  <tbody>{d.items.map((r) => <ReadyRow key={r.invoiceId} r={r} />)}</tbody>
                </Table>
                <Pager offset={readyAt} limit={LIMIT} total={d.total} onPage={setReadyAt} />
              </>
            )}
          </QueryView>
        </section>
      )}
      <h2 className="mb-3 text-xl font-bold">All payments</h2>
      <QueryView q={payments}>
        {(d) => d.total === 0 ? <Empty title="No payments yet" /> : (
          <>
            <Table>
              <thead><tr><Th>Invoice</Th><Th>Vendor</Th><Th>Scheduled</Th><Th>Method</Th><Th>Status</Th><Th>Reference</Th><Th right>Amount</Th>{can(me.role, "release") && <Th />}</tr></thead>
              <tbody>{d.items.map((p) => <PaymentRow key={p.id} p={p} canRelease={can(me.role, "release")} />)}</tbody>
            </Table>
            <Pager offset={allAt} limit={LIMIT} total={d.total} onPage={setAllAt} />
          </>
        )}
      </QueryView>
    </>
  );
}

function ReadyRow({ r }: { r: ReadyToPay }) {
  // Schedule payment schedules the payment with the vendor's preferred method (shown here as the server's own suggestion and reason).
  const prep = useAction(() => api.preparePayment(r.invoiceId), [...REFRESH, ["invoice", String(r.invoiceId)]]);
  const go = () => prep.mutateAsync(undefined)
    .then((p) => notify.money(`Payment scheduled for ${r.invoiceNumber} on ${formatDate(p.scheduledDate)}`, p.notes.length ? { description: p.notes.join(" ") } : {}))
    .catch((e: Error) => notify.error(errorText(e)));
  return (
    <tr>
      <Td><Link to="/invoices/$id" params={{ id: String(r.invoiceId) }} className="font-semibold text-primary hover:underline">{r.invoiceNumber || NOT_READ_YET}</Link></Td>
      <Td>{r.vendorName ?? "—"}</Td><Td className="num">{formatDate(r.dueDate)}</Td>
      <Td>{r.suggestedMethod.label}<div className="text-xs text-muted-foreground">{r.suggestedMethod.reason}</div></Td>
      <Td right><Money cents={r.totalCents} currency={r.currency} className="font-semibold" />{r.earlyPayDiscountCents !== null && <div className="text-xs text-muted-foreground">Early-pay discount <Money cents={r.earlyPayDiscountCents} currency={r.currency} /></div>}</Td>
      <Td className="max-w-56"><Button disabled={prep.isPending} onClick={go}>{prep.isPending ? "Scheduling…" : "Schedule payment"}</Button><p className="mt-1.5 text-xs text-muted-foreground">Picks the payment method and date. No money moves until someone releases it.</p></Td>
    </tr>
  );
}

function PaymentRow({ p, canRelease }: { p: Payment; canRelease: boolean }) {
  // Release moves real money (simulated here): confirm first, lock while it runs, new key per click, and the result stays
  // on screen until someone closes it. The server refuses a second release of the same payment (409) and checks role, size and who prepared it.
  const rel = useAction(() => api.releaseScheduled(p.id), [...REFRESH, ["invoice", String(p.invoiceId)]]);
  const vendor = p.vendorName ?? "the vendor";
  const go = () => rel.mutateAsync(undefined)
    .then((r) => notify.money(`Released ${formatMoney(p.amountCents, p.currency)} to ${vendor} by ${p.methodLabel}. Reference ${r.reference}`))
    .catch((e: Error) => notify.error(errorText(e)));
  return (
    <tr>
      <Td><Link to="/invoices/$id" params={{ id: String(p.invoiceId) }} className="font-semibold text-primary hover:underline">{p.invoiceNumber || NOT_READ_YET}</Link></Td>
      <Td>{p.vendorName ?? "—"}</Td><Td className="num whitespace-nowrap">{formatDate(p.scheduledDate)}</Td><Td>{p.methodLabel}</Td>
      <Td><StatusPill status={p.status} label={p.statusLabel} /></Td>
      <Td className="num text-sm">{p.reference ?? "—"}</Td>
      <Td right><Money cents={p.amountCents} currency={p.currency} className="font-semibold" /></Td>
      {canRelease && <Td>{p.status === "scheduled" && (
        <ConfirmInline label="Release" confirmLabel="Release" pending={rel.isPending}
          message={`Release ${formatMoney(p.amountCents, p.currency)} to ${vendor} via ${p.methodLabel}`} onConfirm={go} />
      )}</Td>}
    </tr>
  );
}

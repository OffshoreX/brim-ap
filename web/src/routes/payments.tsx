import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { Money } from "@/components/Money";
import { StatusPill } from "@/components/StatusPill";
import { ConfirmInline } from "@/components/ConfirmInline";
import { Button } from "@/components/ui/button";
import { useAction, usePayments, useReadyToPay } from "@/hooks/queries";
import { api, downloadUrl } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDate, formatMoney } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { Me, Payment, ReadyToPay } from "@/lib/types";

export const Route = createFileRoute("/payments")({
  ssr: false,
  head: () => pageHead("Payments", "Prepare, release and download Harborline vendor payments."),
  component: () => <AppShell>{(me) => (can(me.role, "payments") ? <PaymentsPage me={me} /> : <Forbidden />)}</AppShell>,
});

const KEYS = [["payments"], ["invoices"], ["invoice-counts"]];

function PaymentsPage({ me }: { me: Me }) {
  const canPrepare = can(me.role, "prepare");
  const ready = useReadyToPay(canPrepare);
  const payments = usePayments();
  return (
    <>
      <PageHeader title="Payments" subtitle="Approved invoices ready to pay, and everything already scheduled."
        actions={can(me.role, "downloads") && (
          <>
            {/* GET /api/payments/eft-file and /api/payments/cheques (downloads) */}
            <Button variant="outline" asChild><a href={downloadUrl("/payments/eft-file")} download><Download aria-hidden />EFT file</a></Button>
            <Button variant="outline" asChild><a href={downloadUrl("/payments/cheques")} download><Download aria-hidden />Cheques</a></Button>
          </>
        )} />
      {canPrepare && (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-bold">Ready to pay</h2>
          <QueryView q={ready}>
            {(rows) => rows.length === 0 ? <Empty title="Nothing ready to pay" to="/approvals" linkLabel="Check approvals">Approved invoices appear here.</Empty> : (
              <Table>
                <thead><tr><Th>Invoice</Th><Th>Vendor</Th><Th>Due</Th><Th>Method</Th><Th right>Amount</Th><Th /></tr></thead>
                <tbody>{rows.map((r) => <ReadyRow key={r.id} r={r} />)}</tbody>
              </Table>
            )}
          </QueryView>
        </section>
      )}
      <h2 className="mb-3 text-xl font-bold">Scheduled and settled</h2>
      <QueryView q={payments}>
        {(rows) => rows.length === 0 ? <Empty title="No payments yet" /> : (
          <Table>
            <thead><tr><Th>Invoice</Th><Th>Vendor</Th><Th>Scheduled</Th><Th>Method</Th><Th>Status</Th><Th right>Amount</Th>{can(me.role, "release") && <Th />}</tr></thead>
            <tbody>{rows.map((p) => <PaymentRow key={p.id} p={p} canRelease={can(me.role, "release")} />)}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

function ReadyRow({ r }: { r: ReadyToPay }) {
  const prep = useAction(() => api.preparePayment(r.id), KEYS);
  return (
    <tr>
      <Td><Link to="/invoices/$id" params={{ id: r.id }} className="font-semibold text-primary hover:underline">{r.invoiceNumber}</Link></Td>
      <Td>{r.vendorName}</Td><Td className="num">{formatDate(r.dueDate)}</Td><Td>{r.method.toUpperCase()}</Td>
      <Td right><Money cents={r.totalCents} currency={r.currency} className="font-semibold" /></Td>
      <Td><Button disabled={prep.isPending} onClick={() => prep.mutateAsync(undefined).then(() => toast.success("Payment prepared")).catch((e: Error) => toast.error(e.message))}>{prep.isPending ? "Preparing…" : "Prepare"}</Button></Td>
    </tr>
  );
}

function PaymentRow({ p, canRelease }: { p: Payment; canRelease: boolean }) {
  const rel = useAction(() => api.releasePayment(p.invoiceId), KEYS);
  return (
    <tr>
      <Td className="font-semibold">{p.invoiceNumber}</Td><Td>{p.vendorName}</Td><Td className="num">{formatDate(p.scheduledFor)}</Td><Td>{p.method.toUpperCase()}</Td>
      <Td><StatusPill status={p.status} /></Td>
      <Td right><Money cents={p.amountCents} currency={p.currency} className="font-semibold" /></Td>
      {canRelease && <Td>{(p.status === "prepared" || p.status === "scheduled") && (
        <ConfirmInline label="Release" confirmLabel="Release" pending={rel.isPending}
          message={`Release ${formatMoney(p.amountCents, p.currency)} to ${p.vendorName} via ${p.method === "eft" ? "EFT" : "cheque"}`}
          onConfirm={() => rel.mutateAsync(undefined).then(() => toast.success("Payment released")).catch((e: Error) => toast.error(e.message))} />
      )}</Td>}
    </tr>
  );
}

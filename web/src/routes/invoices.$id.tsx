import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Panel } from "@/components/Panel";
import { QueryView, ErrorState, Loading } from "@/components/States";
import { StatusPill } from "@/components/StatusPill";
import { Money } from "@/components/Money";
import { FlagBox } from "@/components/FlagBox";
import { ApprovalStepper } from "@/components/ApprovalStepper";
import { ProcessSteps } from "@/components/ProcessSteps";
import { ConfirmInline } from "@/components/ConfirmInline";
import { LineCoding } from "@/components/LineCoding";
import { Table, Th, Td } from "@/components/Table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction, useInvoice, useInvoiceProcessLog, useInvoiceTrail } from "@/hooks/queries";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { InvoiceDetail, Me } from "@/lib/types";

export const Route = createFileRoute("/invoices/$id")({
  ssr: false,
  head: () => pageHead("Invoice", "Invoice details, flags, coding, approvals and audit trail."),
  component: () => <AppShell>{(me) => <InvoicePage me={me} />}</AppShell>,
});

function InvoicePage({ me }: { me: Me }) {
  const { id } = Route.useParams();
  const q = useInvoice(id);
  return <QueryView q={q}>{(inv) => <InvoiceView inv={inv} me={me} />}</QueryView>;
}

function InvoiceView({ inv, me }: { inv: InvoiceDetail; me: Me }) {
  const keys = [["invoice", inv.id], ["invoices"], ["invoice-counts"], ["approvals"], ["payments"]];
  const blocked = inv.status === "blocked" || inv.flags.some((f) => f.severity === "block");
  const [comment, setComment] = useState("");
  const decide = useAction((d: "approve" | "reject") => api.decide(inv.id, d, comment || undefined), keys);
  const process = useAction(() => api.processInvoice(inv.id), keys);
  const release = useAction(() => api.releasePayment(inv.id), keys);
  const showTrail = can(me.role, "trail");
  const trail = useInvoiceTrail(inv.id, showTrail);
  const plog = useInvoiceProcessLog(inv.id);
  const run = (p: Promise<unknown>, ok: string) => p.then(() => toast.success(ok)).catch((e: Error) => toast.error(e.message));
  const method = inv.paymentMethod === "cheque" ? "cheque" : "EFT";

  return (
    <>
      <div className="sticky top-0 z-30 -mx-6 mb-6 glass rounded-b-xl border-t-0 px-6 py-4 md:-mx-10 md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <Link to="/invoices" className="text-sm font-medium text-muted-foreground hover:text-foreground">← Invoices</Link>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{inv.vendorName}</h1>
              <StatusPill status={inv.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{inv.invoiceNumber} · due <span className="num">{formatDate(inv.dueDate)}</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Money cents={inv.totalCents} currency={inv.currency} className="text-2xl font-bold md:text-3xl" />
            {can(me.role, "process") && ["received", "needs_review"].includes(inv.status) && (
              <Button variant="outline" disabled={process.isPending} onClick={() => run(process.mutateAsync(undefined), "Processing started")}>{process.isPending ? "Processing…" : "Run processing"}</Button>
            )}
            {can(me.role, "release") && (inv.status === "approved" || inv.status === "scheduled") && !blocked && (
              <ConfirmInline label="Release payment" pending={release.isPending} confirmLabel="Release"
                message={`Release ${formatMoney(inv.totalCents, inv.currency)} to ${inv.vendorName} via ${method}`}
                onConfirm={() => run(release.mutateAsync(undefined), "Payment released")} />
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <FlagBox flags={inv.flags} footer={blocked && can(me.role, "exceptions") && <Link to="/exceptions" className="font-semibold underline underline-offset-4">Resolve in Exceptions →</Link>} />

          {can(me.role, "decide") && inv.status === "pending_approval" && (
            <Panel title="Your decision">
              {blocked ? <p className="text-sm text-muted-foreground">Approval is unavailable while a blocking flag is open.</p> : (
                <div className="space-y-3">
                  <Textarea placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
                  <div className="flex gap-2">
                    <Button disabled={decide.isPending} onClick={() => run(decide.mutateAsync("approve"), "Invoice approved")}>{decide.isPending ? "Saving…" : "Approve"}</Button>
                    <ConfirmInline variant="destructive" label="Reject" confirmLabel="Reject" pending={decide.isPending} message="Reject this invoice?" onConfirm={() => run(decide.mutateAsync("reject"), "Invoice rejected")} />
                  </div>
                </div>
              )}
            </Panel>
          )}

          <Panel title="Line items">
            <Table>
              <thead><tr><Th>Description</Th><Th right>Qty</Th><Th right>Unit</Th><Th right>Amount</Th><Th>GL coding</Th></tr></thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id}>
                    <Td>{l.description}</Td>
                    <Td right>{l.quantity}</Td>
                    <Td right><Money cents={l.unitPriceCents} currency={inv.currency} /></Td>
                    <Td right><Money cents={l.amountCents} currency={inv.currency} /></Td>
                    <Td><LineCoding invoiceId={inv.id} line={l} editable={can(me.role, "code")} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd><Money cents={inv.subtotalCents} currency={inv.currency} /></dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd><Money cents={inv.taxCents} currency={inv.currency} /></dd></div>
              <div className="flex justify-between border-t border-border pt-1 font-bold"><dt>Total</dt><dd><Money cents={inv.totalCents} currency={inv.currency} /></dd></div>
            </dl>
          </Panel>

          {showTrail && (
            <Panel title="Audit trail">
              <QueryView q={trail}>
                {(t) => t.length ? (
                  <ol className="divide-y divide-border">
                    {t.map((e) => (
                      <li key={e.id} className="flex flex-wrap gap-x-3 py-2.5 text-sm">
                        <span className="num w-44 shrink-0 text-muted-foreground">{formatDateTime(e.at)}</span>
                        <span className="font-semibold">{e.actorName}</span>
                        <span>{e.action}</span>
                        {e.detail && <span className="text-muted-foreground">— {e.detail}</span>}
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-muted-foreground">No trail entries yet.</p>}
              </QueryView>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Approval chain"><ApprovalStepper steps={inv.approvals} /></Panel>
          <Panel title="How this was processed">
            {plog.isPending ? <Loading /> : plog.error ? (
              plog.error instanceof ApiError && plog.error.status === 404 ? <p className="text-sm text-muted-foreground">Processing details are not available yet.</p> : <ErrorState error={plog.error} />
            ) : plog.data && plog.data.length ? <ProcessSteps steps={plog.data} /> : <p className="text-sm text-muted-foreground">No processing steps recorded.</p>}
          </Panel>
          <Panel title="Details">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Invoice date</dt><dd className="num">{formatDate(inv.invoiceDate)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Due date</dt><dd className="num">{formatDate(inv.dueDate)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Payment method</dt><dd>{inv.paymentMethod ? inv.paymentMethod.toUpperCase() : "—"}</dd></div>
              {can(me.role, "vendors") && <div className="flex justify-between"><dt className="text-muted-foreground">Vendor</dt><dd><Link to="/vendors/$id" params={{ id: inv.vendorId }} className="font-semibold text-primary hover:underline">View vendor</Link></dd></div>}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

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
  head: () => pageHead("Invoice", "Invoice details, flags, lines, approvals, payments and audit trail."),
  component: () => <AppShell>{(me) => <InvoicePage me={me} />}</AppShell>,
});

function InvoicePage({ me }: { me: Me }) {
  const { id } = Route.useParams();
  const q = useInvoice(id);
  return <QueryView q={q}>{(inv) => <InvoiceView inv={inv} me={me} />}</QueryView>;
}

const words = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[_.]/g, " ");

function InvoiceView({ inv, me }: { inv: InvoiceDetail; me: Me }) {
  const id = String(inv.id);
  const keys = [["invoice", id], ["invoices"], ["invoice-counts"], ["dashboard"], ["approvals"], ["payments"]];
  const [comment, setComment] = useState("");
  const decide = useAction((d: "approved" | "rejected") => api.decide(inv.id, d, comment), keys);
  const process = useAction(() => api.processInvoice(inv.id), keys);
  const release = useAction((paymentId: number) => api.releaseScheduled(paymentId), keys);
  const showTrail = can(me.role, "trail");
  const trail = useInvoiceTrail(id, showTrail);
  const plog = useInvoiceProcessLog(id);
  // Failures show the server's own sentence (for example "You are not the next approver for this invoice").
  const run = (p: Promise<unknown>, ok: string) => p.then(() => toast.success(ok)).catch((e: Error) => toast.error(e.message));

  const hasError = inv.flags.some((f) => f.severity === "error");
  const vendor = inv.vendorName ?? (inv.vendorId === null ? "Unknown vendor" : `Vendor #${inv.vendorId}`);
  // Buttons below are for looks; the server re-checks the role, the chain and separation of duties on every call.
  const nextStep = inv.approvalChain.find((s) => s.status === "pending");
  const isNextApprover = nextStep?.userId === me.id;
  const isRequester = inv.requesterId === me.id;
  const scheduled = inv.payments.find((p) => p.status === "scheduled");
  const deciding = can(me.role, "decide") && inv.status === "pending_approval";

  return (
    <>
      <div className="sticky top-0 z-30 -mx-6 mb-6 glass rounded-b-xl border-t-0 px-6 py-4 md:-mx-10 md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <Link to="/invoices" className="text-sm font-medium text-muted-foreground hover:text-foreground">← Invoices</Link>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{vendor}</h1>
              <StatusPill status={inv.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{inv.invoiceNumber} · due <span className="num">{formatDate(inv.dueDate)}</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Money cents={inv.totalCents} currency={inv.currency} className="text-2xl font-bold md:text-3xl" />
            {can(me.role, "process") && ["received", "needs_review"].includes(inv.status) && (
              <Button variant="outline" disabled={process.isPending} onClick={() => run(process.mutateAsync(undefined), "Processing finished")}>{process.isPending ? "Processing…" : "Run processing"}</Button>
            )}
            {can(me.role, "release") && inv.status === "scheduled" && scheduled && (
              <ConfirmInline label="Release payment" pending={release.isPending} confirmLabel="Release"
                message={`Release ${formatMoney(scheduled.amountCents, scheduled.currency)} to ${vendor} by ${scheduled.methodLabel}`}
                onConfirm={() => run(release.mutateAsync(scheduled.id), "Payment released")} />
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <FlagBox flags={inv.flags} footer={inv.status === "needs_review" && can(me.role, "exceptions") && <Link to="/exceptions" className="font-semibold underline underline-offset-4">Resolve in Exceptions →</Link>} />

          {deciding && (
            <Panel title="Your decision">
              {!isNextApprover ? (
                <p className="text-sm text-muted-foreground">
                  {isRequester ? "You requested this invoice, so you can't decide it." : nextStep ? `Waiting for ${nextStep.userName ?? "the next approver"} (${nextStep.roleLabel}).` : "This invoice has no approval step waiting."}
                </p>
              ) : (
                <div className="space-y-3">
                  {hasError && <p className="text-sm text-bad-foreground">This invoice has error flags. Read them before you approve.</p>}
                  <Textarea placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
                  <div className="flex gap-2">
                    <Button disabled={decide.isPending} onClick={() => run(decide.mutateAsync("approved"), "Invoice approved")}>{decide.isPending ? "Saving…" : "Approve"}</Button>
                    <ConfirmInline variant="destructive" label="Reject" confirmLabel="Reject" pending={decide.isPending} message="Reject this invoice?" onConfirm={() => run(decide.mutateAsync("rejected"), "Invoice rejected")} />
                  </div>
                </div>
              )}
            </Panel>
          )}

          <Panel title="Line items">
            <Table>
              <thead><tr><Th>Description</Th><Th right>Qty</Th><Th right>Unit</Th><Th right>Amount</Th><Th>GL account</Th></tr></thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.lineNo}>
                    <Td>{l.description}</Td>
                    <Td right>{l.quantity}</Td>
                    <Td right><Money cents={l.unitPriceCents} currency={l.currency} /></Td>
                    <Td right><Money cents={l.amountCents} currency={l.currency} /></Td>
                    <Td>{l.glCode ? <span><span className="font-medium">{l.glCode}</span><span className="text-muted-foreground"> · {l.glName}</span></span> : <span className="font-medium text-warn-foreground">Not coded</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
              {([["Subtotal", inv.subtotalCents], ["GST / HST", inv.gstHstCents], ["PST / QST", inv.pstQstCents]] as const).map(([label, cents]) => cents !== null && (
                <div key={label} className="flex justify-between"><dt className="text-muted-foreground">{label}</dt><dd><Money cents={cents} currency={inv.currency} /></dd></div>
              ))}
              <div className="flex justify-between border-t border-border pt-1 font-bold"><dt>Total</dt><dd><Money cents={inv.totalCents} currency={inv.currency} /></dd></div>
              {inv.currency !== "CAD" && inv.totalCadCents !== null && <div className="flex justify-between"><dt className="text-muted-foreground">In CAD</dt><dd><Money cents={inv.totalCadCents} currency="CAD" /></dd></div>}
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
                        <span>{words(e.action)}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-muted-foreground">No trail entries yet.</p>}
              </QueryView>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Approval chain"><ApprovalStepper chain={inv.approvalChain} decisions={inv.approvals} /></Panel>
          <Panel title="Payments">
            {inv.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payment has been prepared for this invoice.</p> : (
              <ul className="divide-y divide-border">
                {inv.payments.map((p) => (
                  <li key={p.id} className="space-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2"><span className="font-semibold">{p.methodLabel}</span><StatusPill status={p.status} label={p.statusLabel} /></div>
                    <Money cents={p.amountCents} currency={p.currency} className="font-semibold" />
                    <p className="text-muted-foreground">{p.paidAt ? `Paid ${formatDate(p.paidAt)}` : `Scheduled for ${formatDate(p.scheduledDate)}`}{p.reference && ` · ${p.reference}`}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="How this was processed">
            {plog.isPending ? <Loading /> : plog.error ? (
              plog.error instanceof ApiError && plog.error.status === 404 ? <p className="text-sm text-muted-foreground">Processing details are not available yet.</p> : <ErrorState error={plog.error} />
            ) : plog.data && plog.data.length ? <ProcessSteps steps={plog.data} /> : <p className="text-sm text-muted-foreground">No processing steps recorded.</p>}
          </Panel>
          <Panel title="Details">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Invoice date</dt><dd className="num">{formatDate(inv.invoiceDate)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Due date</dt><dd className="num">{formatDate(inv.dueDate)}</dd></div>
              {inv.vendor && <div className="flex justify-between"><dt className="text-muted-foreground">Payment terms</dt><dd>{inv.vendor.paymentTermsDays === null ? "—" : `Net ${inv.vendor.paymentTermsDays} days`}</dd></div>}
              {inv.sourceEmail && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Received from</dt><dd className="min-w-0 truncate text-right" title={inv.sourceEmail.subject}>{inv.sourceEmail.from}</dd></div>}
              {inv.sourceFile && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">File</dt><dd className="min-w-0 truncate text-right">{inv.sourceFile}</dd></div>}
              {can(me.role, "vendors") && inv.vendorId !== null && <div className="flex justify-between"><dt className="text-muted-foreground">Vendor</dt><dd><Link to="/vendors/$id" params={{ id: String(inv.vendorId) }} className="font-semibold text-primary hover:underline">View vendor</Link></dd></div>}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

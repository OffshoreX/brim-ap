"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FlagBox, Load, money, post, topFlag, type Flag } from "@/components/api";
import { ActionButton, ConfirmAction, useActions } from "@/components/actions";
import { CAN_CLERK, CAN_DECIDE, CAN_RELEASE, useCan, useCurrentUser } from "@/components/CurrentUser";
import { Empty, SeverityChip, StatusBadge, Table, ymd } from "@/components/ui";
import { AuditTable, type AuditRow } from "@/components/AuditTable";

type Line = { lineNo: number; description: string; quantity: number; unitPriceCents: number; amountCents: number; currency: string; taxCents: number | null; glCode: string | null };
type Step = { stepNo: number; role: string; roleLabel: string; actorName: string | null; delegatedFromId: number | null; delegatedFromName: string | null; reason: string | null; status: string };
type Pay = { id: number; method: string; methodLabel: string; status: string; scheduledDate: string | null; amountCents: number; currency: string; reference: string | null };
type Detail = {
  id: number; status: string; invoiceNumber: string; invoiceDate: string; dueDate: string | null; subtotalCents: number | null;
  gstHstCents: number | null; pstQstCents: number | null; totalCents: number; currency: string; vendorName: string | null;
  extraction: unknown; flags: Flag[]; lines: Line[]; approvalChain: Step[]; approvals: { id: number; stepNo: number; decision: string; decidedAt: string; comment: string | null }[]; payments: Pay[];
};

// GET /api/invoices/{id} and /trail; POST /api/invoices/{id}/decision, /api/payments/prepare, /api/payments/release.
export default function InvoicePage() {
  const id = Number(useParams<{ id: string }>().id);
  const [version, setVersion] = useState(0);
  const [comment, setComment] = useState("");
  const a = useActions(() => setVersion((v) => v + 1));
  // Hiding is for looks; the server decides (requireRole on each route). A role that can never use a button sees one line instead.
  const { role } = useCurrentUser();
  const [canDecide, canPrepare, canRelease] = [useCan(CAN_DECIDE), useCan(CAN_CLERK), useCan(CAN_RELEASE)];
  const idem = (key: string) => ({ "idempotency-key": key });
  const decide = (decision: "approved" | "rejected", text: string) => () => post(`/api/invoices/${id}/decision`, { decision, comment: text });

  return (
    <main id="main">
      <Load<Detail> url={`/api/invoices/${id}?v=${version}`} heading={(d) => <>Invoice {d?.invoiceNumber || id}</>}>
        {(d) => {
          const payee = d.vendorName ?? "unknown vendor";
          const top = topFlag(d.flags);
          return (
          <>
            <p className="only-print">Status: <StatusBadge status={d.status} /></p>
            <section className="decisionbar no-print" aria-label="Decision">
              <div className="decision-facts">
                <p className="decision-line">
                  <strong>{payee}</strong><span className="num"><strong>{money(d.totalCents, d.currency)}</strong></span><span>Due {ymd(d.dueDate)}</span><StatusBadge status={d.status} />
                </p>
                {top && (
                  <p className={`decision-flag decision-flag-${top.severity ?? "warning"}`}>
                    <SeverityChip severity={top.severity} /> {top.severity === "error" && <strong>Blocked: </strong>}{top.message}
                    {d.flags.length > 1 && <span className="muted"> (and {d.flags.length - 1} more below)</span>}
                  </p>
                )}
              </div>
              <div className="decision-actions">
                <div className="row">
                  {d.status === "pending_approval" && role && !canDecide && <p className="muted">Only approvers, finance managers and controllers can approve or reject this.</p>}
                  {d.status === "pending_approval" && canDecide && (
                    <>
                      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" aria-label="Approval comment" />
                      <ActionButton icon="approved" label="Approve" busyLabel="Approving…" ariaLabel={`Approve invoice ${d.invoiceNumber || id} from ${payee}`} busy={a.busyKey === "approve"} locked={a.locked}
                        onClick={() => a.run("approve", decide("approved", comment), "Invoice approved")} />
                      <ConfirmAction secondary icon="rejected" label="Reject" busyLabel="Rejecting…" ariaLabel={`Reject invoice ${d.invoiceNumber || id} from ${payee}`} busy={a.busyKey === "reject"} locked={a.locked}
                        title="Confirm rejection" ask={{ label: "Reason for rejecting", required: true }}
                        facts={[["Invoice", d.invoiceNumber || String(id)], ["Vendor", payee], ["Total", money(d.totalCents, d.currency)]]} confirmLabel={`Reject invoice from ${payee}`}
                        onConfirm={(reason) => a.run("reject", decide("rejected", reason), "Invoice rejected")} />
                    </>
                  )}
                  {d.status === "approved" && role && !canPrepare && <p className="muted">Only AP clerks, finance managers and controllers can prepare a payment.</p>}
                  {d.status === "approved" && canPrepare && (
                    <ActionButton icon="paid" label="Prepare payment" busyLabel="Preparing…" ariaLabel={`Prepare payment for invoice ${d.invoiceNumber || id} from ${payee}`} busy={a.busyKey === "prepare"} locked={a.locked}
                      onClick={() => a.run("prepare", () => post("/api/payments/prepare", { invoiceId: id }, idem(crypto.randomUUID())), "Payment prepared")} />
                  )}
                  {d.status === "needs_review" && (
                    <p>
                      {canPrepare && <Link href="/exceptions">Resolve in Exceptions</Link>}{" "}
                      <span className="muted">AP clerks, finance managers and controllers can resolve this.</span>
                    </p>
                  )}
                  {role && !canRelease && d.payments.some((p) => p.status === "scheduled") && <p className="muted">Only finance managers and controllers can release a payment.</p>}
                  {canRelease && d.payments.filter((p) => p.status === "scheduled").map((p) => {
                    const amount = money(p.amountCents, p.currency);
                    return (
                      <ConfirmAction key={p.id} icon="paid" label={`Release payment ${p.id}`} busyLabel="Releasing…" ariaLabel={`Release payment ${p.id} to ${payee}`} busy={a.busyKey === `release-${p.id}`} locked={a.locked}
                        title={`Confirm release of payment ${p.id}`} facts={[["Amount", amount], ["Payee", payee], ["Method", p.methodLabel], ["Scheduled", ymd(p.scheduledDate)]]} confirmLabel={`Release ${amount} to ${payee} via ${p.methodLabel}`}
                        onConfirm={(_, key) => a.run(`release-${p.id}`, () => post("/api/payments/release", { paymentId: p.id }, idem(key)), `Payment ${p.id} released: ${amount} to ${payee} via ${p.methodLabel}`)} />
                    );
                  })}
                </div>
                {["approve", "reject", "prepare", ...d.payments.map((p) => `release-${p.id}`)].map((k) => <div key={k}>{a.show(k)}</div>)}
              </div>
            </section>
            <FlagBox flags={d.flags} />
            <div className="split">
              <section className="panel">
                <h2>File</h2>
                <object className="preview" data={`/api/invoices/${id}/file`}>Preview not available for this file.</object>
              </section>
              <section className="panel">
                <h2>Extracted fields</h2>
                <dl className="fields">
                  <dt>Vendor</dt><dd>{d.vendorName ?? "—"}</dd>
                  <dt>Invoice no.</dt><dd>{d.invoiceNumber || "—"}</dd>
                  <dt>Date</dt><dd>{ymd(d.invoiceDate)}</dd>
                  <dt>Due</dt><dd>{ymd(d.dueDate)}</dd>
                  <dt>Subtotal</dt><dd>{money(d.subtotalCents, d.currency)}</dd>
                  <dt>GST/HST</dt><dd>{money(d.gstHstCents, d.currency)}</dd>
                  <dt>PST/QST</dt><dd>{money(d.pstQstCents, d.currency)}</dd>
                  <dt><strong>Total</strong></dt><dd><strong>{money(d.totalCents, d.currency)}</strong></dd>
                </dl>
                <details><summary>Raw extraction</summary><pre>{JSON.stringify(d.extraction, null, 2)}</pre></details>
              </section>
            </div>
            <h2>Lines</h2>
            <Table>
              <thead><tr><th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th><th className="num">Tax</th><th>GL</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPriceCents, l.currency)}</td>
                    <td className="num">{money(l.amountCents, l.currency)}</td><td className="num">{money(l.taxCents, l.currency)}</td><td>{l.glCode ?? "—"}</td></tr>
                ))}
              </tbody>
            </Table>
            <h2>Approval chain</h2>
            {d.approvalChain.length === 0 ? <Empty>No approval steps yet. They are created when the invoice is routed.</Empty> : (
              <ol className="steps">
                {d.approvalChain.map((s) => {
                  const done = d.approvals.find((x) => x.stepNo === s.stepNo);
                  return (
                    <li key={s.stepNo} className={`step-${done?.decision ?? "pending"}`}>
                      <strong>Step {s.stepNo}: {s.roleLabel}</strong> — {s.actorName ?? "unassigned"}{s.delegatedFromId ? ` · Delegate for ${s.delegatedFromName ?? "another approver"}` : ""}
                      {s.reason && <span className="muted"> · {s.reason}</span>}
                      <br />
                      {done ? <>{done.decision.charAt(0).toUpperCase() + done.decision.slice(1)} on {ymd(done.decidedAt)}{done.comment ? ` — “${done.comment}”` : ""}</> : <span className="muted">{s.status === "pending" ? `Waiting for ${s.actorName ?? s.roleLabel}` : s.status}</span>}
                    </li>
                  );
                })}
              </ol>
            )}
          </>
          );
        }}
      </Load>
      <details>
        <summary>Audit trail</summary>
        <Load<AuditRow[]> url={`/api/invoices/${id}/trail?v=${version}`}>
          {(rows) => rows.length === 0 ? <Empty>No audit entries for this invoice yet.</Empty> : (
            <AuditTable rows={rows} />
          )}
        </Load>
      </details>
    </main>
  );
}

"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Flags, Load, money, Notice, post, type Flag } from "@/components/api";
import { Empty, StatusBadge, Table } from "@/components/ui";

type Line = { lineNo: number; description: string; quantity: number; unitPriceCents: number; amountCents: number; currency: string; taxCents: number | null; glCode: string | null };
type Step = { stepNo: number; role: string; userName: string | null; delegatedFromId: number | null; reason: string | null; status: string };
type Pay = { id: number; method: string; status: string; scheduledDate: string | null; amountCents: number; currency: string; reference: string | null };
type Detail = {
  id: number; status: string; invoiceNumber: string; invoiceDate: string; dueDate: string | null; subtotalCents: number | null;
  gstHstCents: number | null; pstQstCents: number | null; totalCents: number; currency: string; vendor: { name: string } | null;
  extraction: unknown; flags: Flag[]; lines: Line[]; approvalChain: Step[]; approvals: { id: number; stepNo: number; decision: string; decidedAt: string; comment: string | null }[]; payments: Pay[];
};
type Audit = { id: number; at: string; actorId: number | null; action: string; before: unknown; after: unknown };

// GET /api/invoices/{id} and /trail; POST /api/invoices/{id}/decision, /api/payments/prepare, /api/payments/release.
export default function InvoicePage() {
  const id = Number(useParams<{ id: string }>().id);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [comment, setComment] = useState("");

  async function act(url: string, body: unknown, done: string) {
    const r = await post(url, body);
    setMsg(r.error ? { error: r.error } : { ok: done });
    if (!r.error) setVersion((v) => v + 1);
  }

  return (
    <main>
      <h1>Invoice {id}</h1>
      <Load<Detail> url={`/api/invoices/${id}?v=${version}`}>
        {(d) => (
          <>
            <p>Status: <StatusBadge status={d.status} /></p>
            {d.flags.length > 0 && (
              <section className="flagbox" aria-label="Flags">
                <h2>Why this needs attention ({d.flags.length})</h2>
                <Flags flags={d.flags} />
              </section>
            )}
            <div className="row">
              {d.status === "pending_approval" && (
                <>
                  <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" aria-label="Comment" />
                  <button onClick={() => act(`/api/invoices/${id}/decision`, { decision: "approved", comment }, "Approved")}>Approve</button>
                  <button onClick={() => act(`/api/invoices/${id}/decision`, { decision: "rejected", comment }, "Rejected")}>Reject</button>
                </>
              )}
              {d.status === "approved" && <button onClick={() => act("/api/payments/prepare", { invoiceId: id }, "Payment prepared")}>Prepare payment</button>}
              {d.payments.filter((p) => p.status === "scheduled").map((p) => (
                <button key={p.id} onClick={() => act("/api/payments/release", { paymentId: p.id }, `Payment ${p.id} released`)}>Release payment {p.id}</button>
              ))}
            </div>
            <Notice {...msg} />
            <div className="split">
              <section className="panel">
                <h2>File</h2>
                <object className="preview" data={`/api/invoices/${id}/file`}>Preview not available for this file.</object>
              </section>
              <section className="panel">
                <h2>Extracted fields</h2>
                <dl className="fields">
                  <dt>Vendor</dt><dd>{d.vendor?.name ?? "—"}</dd>
                  <dt>Invoice no.</dt><dd>{d.invoiceNumber || "—"}</dd>
                  <dt>Date</dt><dd>{d.invoiceDate || "—"}</dd>
                  <dt>Due</dt><dd>{d.dueDate ?? "—"}</dd>
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
                  const done = d.approvals.find((a) => a.stepNo === s.stepNo);
                  return (
                    <li key={s.stepNo} className={`step-${done?.decision ?? "pending"}`}>
                      <strong>Step {s.stepNo}: {s.role.replaceAll("_", " ")}</strong> — {s.userName ?? "unassigned"}{s.delegatedFromId ? " (delegate)" : ""}
                      {s.reason && <span className="muted"> · {s.reason}</span>}
                      <br />
                      {done ? <>{done.decision} on {done.decidedAt}{done.comment ? ` — “${done.comment}”` : ""}</> : <span className="muted">Waiting ({s.status})</span>}
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </Load>
      <details>
        <summary>Audit trail</summary>
        <Load<Audit[]> url={`/api/invoices/${id}/trail?v=${version}`}>
          {(rows) => rows.length === 0 ? <Empty>No audit entries for this invoice yet.</Empty> : (
            <Table>
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}><td>{r.at}</td><td>{r.actorId ?? "system"}</td><td>{r.action}</td><td><code>{JSON.stringify(r.before)}</code></td><td><code>{JSON.stringify(r.after)}</code></td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Load>
      </details>
    </main>
  );
}

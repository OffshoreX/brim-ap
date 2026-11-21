"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Flags, Load, money, Notice, post, type Flag } from "@/components/api";

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
            <p>Status: <strong>{d.status}</strong></p>
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
              <section>
                <h2>Extracted fields</h2>
                <table><tbody>
                  <tr><th>Vendor</th><td>{d.vendor?.name ?? "—"}</td></tr>
                  <tr><th>Invoice no.</th><td>{d.invoiceNumber || "—"}</td></tr>
                  <tr><th>Date / due</th><td>{d.invoiceDate || "—"} / {d.dueDate ?? "—"}</td></tr>
                  <tr><th>Subtotal</th><td>{money(d.subtotalCents, d.currency)}</td></tr>
                  <tr><th>GST/HST</th><td>{money(d.gstHstCents, d.currency)}</td></tr>
                  <tr><th>PST/QST</th><td>{money(d.pstQstCents, d.currency)}</td></tr>
                  <tr><th>Total</th><td>{money(d.totalCents, d.currency)}</td></tr>
                </tbody></table>
                <details><summary>Raw extraction</summary><pre>{JSON.stringify(d.extraction, null, 2)}</pre></details>
              </section>
              <section>
                <h2>File</h2>
                <object className="preview" data={`/api/invoices/${id}/file`}>Preview not available for this file.</object>
              </section>
            </div>
            <h2>Lines</h2>
            <table>
              <thead><tr><th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th><th className="num">Tax</th><th>GL</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPriceCents)}</td>
                    <td className="num">{money(l.amountCents, l.currency)}</td><td className="num">{money(l.taxCents)}</td><td>{l.glCode ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
            <h2>Flags</h2>
            <Flags flags={d.flags} />
            <h2>Approval chain</h2>
            <table>
              <thead><tr><th>Step</th><th>Role</th><th>Approver</th><th>Status</th><th>Reason</th></tr></thead>
              <tbody>
                {d.approvalChain.map((s) => (
                  <tr key={s.stepNo}><td>{s.stepNo}</td><td>{s.role}</td><td>{s.userName ?? "—"}{s.delegatedFromId ? " (delegate)" : ""}</td><td>{s.status}</td><td>{s.reason ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
            {d.approvals.map((a) => <p key={a.id}>Step {a.stepNo}: {a.decision} at {a.decidedAt}{a.comment ? ` — ${a.comment}` : ""}</p>)}
          </>
        )}
      </Load>
      <h2>Audit trail</h2>
      <Load<Audit[]> url={`/api/invoices/${id}/trail?v=${version}`}>
        {(rows) => (
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Before</th><th>After</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td>{r.at}</td><td>{r.actorId ?? "system"}</td><td>{r.action}</td><td><code>{JSON.stringify(r.before)}</code></td><td><code>{JSON.stringify(r.after)}</code></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Load>
    </main>
  );
}

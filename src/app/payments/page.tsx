"use client";
import { useState, type FormEvent } from "react";
import { download, Load, money, Notice, post } from "@/components/api";

type Pay = { id: number; invoiceId: number; invoiceNumber: string; method: string; status: string; scheduledDate: string | null; paidAt: string | null; amountCents: number; currency: string; reference: string | null };
type Cheque = { paymentId: number; invoiceNumber: string; vendor: string | null; address: string | null; amountCents: number; currency: string; reference: string | null };

// GET /api/payments, /api/payments/cheques, /api/payments/eft-file; POST /api/payments/prepare and /release.
export default function PaymentsPage() {
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  async function act(url: string, body: unknown, done: string) {
    const r = await post(url, body);
    setMsg(r.error ? { error: r.error } : { ok: done });
    if (!r.error) setVersion((v) => v + 1);
  }
  function prepare(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const method = String(f.get("method"));
    act("/api/payments/prepare", { invoiceId: Number(f.get("invoiceId")), ...(method ? { method } : {}) }, "Payment prepared");
  }

  return (
    <main>
      <h1>Payments</h1>
      <form onSubmit={prepare} className="inline">
        <label>Invoice # <input name="invoiceId" type="number" min="1" required /></label>
        <label>Method{" "}
          <select name="method"><option value="">Vendor default</option><option>EFT</option><option>CHEQUE</option><option>CARD</option></select>
        </label>
        <button type="submit">Prepare payment</button>
      </form>
      <Notice {...msg} />
      <Load<Pay[]> url={`/api/payments?v=${version}`}>
        {(rows) => (
          <table>
            <thead><tr><th>#</th><th>Invoice</th><th>Method</th><th>Status</th><th>Scheduled</th><th className="num">Amount</th><th>Reference</th><th></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td><td>{p.invoiceNumber}</td><td>{p.method}</td><td>{p.status}</td><td>{p.scheduledDate ?? ""}</td>
                  <td className="num">{money(p.amountCents, p.currency)}</td><td>{p.reference ?? ""}</td>
                  <td>{p.status === "scheduled" && <button onClick={() => act("/api/payments/release", { paymentId: p.id }, `Payment ${p.id} released`)}>Release</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Load>
      <h2>EFT file</h2>
      <p><button onClick={async () => setMsg({ error: await download("/api/payments/eft-file", "eft-file.csv") })}>Download EFT file (released EFT payments)</button></p>
      <h2>Cheques to print</h2>
      <Load<{ cheques: Cheque[] }> url={`/api/payments/cheques?v=${version}`}>
        {({ cheques }) =>
          cheques.length === 0 ? <p>No released cheques.</p> : (
            <table>
              <thead><tr><th>Payee</th><th>Address</th><th>Invoice</th><th className="num">Amount</th><th>Reference</th></tr></thead>
              <tbody>
                {cheques.map((c) => (
                  <tr key={c.paymentId}><td>{c.vendor}</td><td>{c.address}</td><td>{c.invoiceNumber}</td><td className="num">{money(c.amountCents, c.currency)}</td><td>{c.reference}</td></tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Load>
    </main>
  );
}

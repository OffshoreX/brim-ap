"use client";
import { useState, type FormEvent } from "react";
import { Empty, StatusBadge, Table } from "@/components/ui";
import { download, Load, money, Notice, post, useApi } from "@/components/api";
import RoleHome from "@/components/RoleHome";
import type { MeResponse, Role } from "@/contracts";

type Pay = { id: number; invoiceId: number; invoiceNumber: string; method: string; status: string; scheduledDate: string | null; paidAt: string | null; amountCents: number; currency: string; reference: string | null };
type Cheque = { paymentId: number; invoiceNumber: string; vendor: string | null; address: string | null; amountCents: number; currency: string; reference: string | null };

// GET /api/payments, /api/payments/cheques, /api/payments/eft-file; POST /api/payments/prepare and /release.
export default function PaymentsPage() {
  const [version, setVersion] = useState(0);
  // Hiding is for looks; the server answers 403 to anything the role may not do.
  const role = useApi<MeResponse>("/api/me").data?.user.role;
  const can = (...r: Role[]) => !!role && r.includes(role);
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
      <RoleHome page="/payments" />
      {can("ap_clerk", "finance_manager", "controller_admin") && <form onSubmit={prepare} className="inline">
        <label>Invoice # <input name="invoiceId" type="number" min="1" required /></label>
        <label>Method{" "}
          <select name="method"><option value="">Vendor default</option><option>EFT</option><option>CHEQUE</option><option>CARD</option></select>
        </label>
        <button type="submit">Prepare payment</button>
      </form>}
      <Notice {...msg} />
      <Load<Pay[]> url={`/api/payments?v=${version}`}>
        {(rows) => rows.length === 0 ? <Empty>No payments yet. Prepare one from an approved invoice.</Empty> : (
          <Table>
            <thead><tr><th>#</th><th>Invoice</th><th>Method</th><th>Status</th><th>Scheduled</th><th className="num">Amount</th><th>Reference</th><th></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td><td>{p.invoiceNumber}</td><td>{p.method}</td><td><StatusBadge status={p.status} /></td><td>{p.scheduledDate ?? ""}</td>
                  <td className="num">{money(p.amountCents, p.currency)}</td><td>{p.reference ?? ""}</td>
                  <td>{p.status === "scheduled" && can("finance_manager", "controller_admin") && <button onClick={() => act("/api/payments/release", { paymentId: p.id }, `Payment ${p.id} released`)}>Release</button>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Load>
      {can("finance_manager", "controller_admin", "auditor") && <>
      <h2>EFT file</h2>
      <p><button onClick={async () => setMsg({ error: await download("/api/payments/eft-file", "eft-file.csv") })}>Download EFT file (released EFT payments)</button></p>
      <h2>Cheques to print</h2>
      <Load<{ cheques: Cheque[] }> url={`/api/payments/cheques?v=${version}`}>
        {({ cheques }) =>
          cheques.length === 0 ? <Empty>No released cheques to print.</Empty> : (
            <Table>
              <thead><tr><th>Payee</th><th>Address</th><th>Invoice</th><th className="num">Amount</th><th>Reference</th></tr></thead>
              <tbody>
                {cheques.map((c) => (
                  <tr key={c.paymentId}><td>{c.vendor}</td><td>{c.address}</td><td>{c.invoiceNumber}</td><td className="num">{money(c.amountCents, c.currency)}</td><td>{c.reference}</td></tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </Load>
      </>}
    </main>
  );
}

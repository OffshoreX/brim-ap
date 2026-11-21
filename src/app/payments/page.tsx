"use client";
import { useState, type FormEvent } from "react";
import { Empty, StatusBadge, Table, ymd } from "@/components/ui";
import { download, Load, money, post } from "@/components/api";
import { ActionButton, ConfirmAction, useActions } from "@/components/actions";
import RoleHome from "@/components/RoleHome";
import { ReadyTable, type ReadyRow } from "@/components/ReadyTable";
import type { Role } from "@/contracts";
import { useCurrentUser } from "@/components/CurrentUser";

type Pay = { id: number; invoiceId: number; invoiceNumber: string; vendorName: string | null; method: string; methodLabel: string; status: string; statusLabel?: string; scheduledDate: string | null; paidAt: string | null; amountCents: number; currency: string; reference: string | null };
type Cheque = { paymentId: number; invoiceNumber: string; vendor: string | null; address: string | null; amountCents: number; currency: string; reference: string | null };

// One row's Release: the confirm step names the amount, payee, method and date; the server still refuses a second release (409).
function Release({ p, a }: { p: Pay; a: ReturnType<typeof useActions> }) {
  const payee = p.vendorName ?? "unknown vendor";
  const amount = money(p.amountCents, p.currency);
  return (
    <ConfirmAction icon="paid" label="Release" busyLabel="Releasing…" ariaLabel={`Release payment ${p.id} to ${payee}`} busy={a.busyKey === `release-${p.id}`} locked={a.locked}
      title={`Confirm release of payment ${p.id}`} facts={[["Amount", amount], ["Payee", payee], ["Method", p.methodLabel], ["Scheduled", ymd(p.scheduledDate)]]} confirmLabel={`Release ${amount} to ${payee} via ${p.methodLabel}`}
      onConfirm={(_, key) => a.run(`release-${p.id}`, () => post("/api/payments/release", { paymentId: p.id }, { "idempotency-key": key }), `Payment ${p.id} released: ${amount} to ${payee} via ${p.methodLabel}`)} />
  );
}

// GET /api/payments, /api/payments/ready, /api/payments/cheques, /api/payments/eft-file; POST /api/payments/prepare and /release.
export default function PaymentsPage() {
  const [version, setVersion] = useState(0);
  // Hiding is for looks; the server answers 403 to anything the role may not do.
  const { role } = useCurrentUser();
  const can = (...r: Role[]) => !!role && r.includes(role);
  const a = useActions(() => setVersion((v) => v + 1));
  return (
    <main id="main">
      <h1>Payments</h1>
      <RoleHome page="/payments" />
      {can("ap_clerk", "finance_manager", "controller_admin") && <>
        <h2>Ready to pay</h2>
        <Load<ReadyRow[]> url={`/api/payments/ready?v=${version}`}>{(rows) => <ReadyTable rows={rows} a={a} />}</Load>
      </>}
      <h2>Payments</h2>
      <Load<Pay[]> url={`/api/payments?v=${version}`}>
        {(rows) => rows.length === 0 ? <Empty href="/invoices" next="Find an approved invoice">No payments yet. Prepare one from an approved invoice.</Empty> : (
          <Table>
            <thead><tr><th>#</th><th>Invoice</th><th>Vendor</th><th>Method</th><th>Status</th><th className="num">Scheduled</th><th className="num">Amount</th><th>Reference</th><th></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td><td className="nowrap">{p.invoiceNumber}</td><td>{p.vendorName ?? "—"}</td><td>{p.methodLabel}</td><td><StatusBadge status={p.status} label={p.statusLabel} /></td><td className="num">{ymd(p.scheduledDate)}</td>
                  <td className="num">{money(p.amountCents, p.currency)}</td><td>{p.reference ?? ""}</td>
                  <td>
                    {p.status === "scheduled" && can("finance_manager", "controller_admin") && <Release p={p} a={a} />}
                    {a.show(`release-${p.id}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Load>
      {can("finance_manager", "controller_admin", "auditor") && <>
      <h2>EFT file</h2>
      <p>
        <ActionButton icon="download" label="Download EFT file (released EFT payments)" busyLabel="Preparing file…" busy={a.busyKey === "eft"} locked={a.locked}
          onClick={() => a.run("eft", async () => ({ error: await download("/api/payments/eft-file", "eft-file.csv") }), "EFT file downloaded")} />
      </p>
      {a.show("eft")}
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

"use client";
import Link from "next/link";
import { ConfirmAction, type useActions } from "./actions";
import { Empty, Table, ymd } from "./ui";
import { money, post } from "./api";

// Shape of GET /api/payments/ready rows (src/server/views.ts readyToPay).
export type ReadyRow = {
  invoiceId: number; invoiceNumber: string; vendorName: string | null; totalCents: number; currency: string; dueDate: string | null;
  suggestedMethod: { method: string; label: string; reason: string }; earlyPayDiscountCents: number | null;
};

// Prepares by invoice id, with no method: the server picks the vendor's method, so the suggestion shown here is only a preview.
export const prepareInvoice = (invoiceId: number, key = crypto.randomUUID()) => post("/api/payments/prepare", { invoiceId }, { "idempotency-key": key });

export function ReadyTable({ rows, a }: { rows: ReadyRow[]; a: ReturnType<typeof useActions> }) {
  if (rows.length === 0) return <Empty href="/invoices" next="Find an approved invoice">Nothing is ready to pay. An invoice shows here once it is approved.</Empty>;
  return (
    <Table>
      <thead><tr><th>Vendor</th><th>Invoice</th><th className="num">Total</th><th>Due</th><th>Suggested method</th><th className="num">Early-pay discount</th><th></th></tr></thead>
      <tbody>
        {rows.map((r) => {
          const payee = r.vendorName ?? "unknown vendor";
          const total = money(r.totalCents, r.currency);
          return (
            <tr key={r.invoiceId}>
              <td>{payee}</td>
              <td><Link href={`/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link></td>
              <td className="num">{total}</td>
              <td>{ymd(r.dueDate)}</td>
              <td><strong>{r.suggestedMethod.label}</strong> <span className="muted">{r.suggestedMethod.reason}</span></td>
              <td className="num">{r.earlyPayDiscountCents ? money(r.earlyPayDiscountCents, r.currency) : "None"}</td>
              <td>
                <ConfirmAction icon="paid" label="Prepare" busyLabel="Preparing…" ariaLabel={`Prepare payment for ${r.invoiceNumber}`} busy={a.busyKey === `prepare-${r.invoiceId}`} locked={a.locked}
                  title={`Confirm payment for ${r.invoiceNumber}`} facts={[["Amount", total], ["Payee", payee], ["Method", r.suggestedMethod.label]]} confirmLabel={`Prepare ${total} to ${payee}`}
                  onConfirm={(_, key) => a.run(`prepare-${r.invoiceId}`, () => prepareInvoice(r.invoiceId, key), `Payment prepared for ${r.invoiceNumber}: ${total} to ${payee}`)} />
                {a.show(`prepare-${r.invoiceId}`)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

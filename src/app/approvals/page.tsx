"use client";
import Link from "next/link";
import { Load, money } from "@/components/api";

type Row = { invoiceId: number; stepNo: number; role: string; reason: string | null; invoiceNumber: string; totalCents: number; currency: string; delegatedFromId: number | null };

// GET /api/approvals/inbox. Approve or reject on the invoice page.
export default function ApprovalsPage() {
  return (
    <main>
      <h1>Approvals inbox</h1>
      <Load<Row[]> url="/api/approvals/inbox">
        {(rows) =>
          rows.length === 0 ? <p>Nothing waiting for you.</p> : (
            <table>
              <thead><tr><th>Invoice</th><th>Step</th><th>As</th><th className="num">Total</th><th>Why you</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.invoiceId}>
                    <td><Link href={`/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link></td><td>{r.stepNo}</td>
                    <td>{r.role}{r.delegatedFromId ? " (delegated)" : ""}</td><td className="num">{money(r.totalCents, r.currency)}</td><td>{r.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Load>
    </main>
  );
}

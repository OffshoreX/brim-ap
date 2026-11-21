"use client";
import Link from "next/link";
import { useState } from "react";
import { Empty, Table } from "@/components/ui";
import { download, Load, money, Notice, useApi } from "@/components/api";
import { Icon } from "@/components/icons";

export type Category = "matched" | "payment_unmatched" | "payment_ambiguous" | "amount_diff" | "duplicate" | "bank_no_payment" | "card_no_payment";
type Row = { category: Category; paymentId: number | null; invoiceNumber: string | null; vendor: string | null; method: string | null; paymentCents: number | null; lineSource: string | null; lineId: string | null; lineText: string | null; lineDate: string | null; lineCents: number | null; diffCents: number | null; note: string };
type Report = { summary: Record<Category, number>; total: number; rows: Row[] };

const LABEL: Record<Category, string> = {
  matched: "Matched", payment_unmatched: "Payment with no bank or card line", payment_ambiguous: "Payment with several possible lines",
  amount_diff: "Amount differs", duplicate: "Duplicate line", bank_no_payment: "Bank debit with no payment", card_no_payment: "Card charge with no payment",
};
// Each tab shows one or more server categories; every category is its own request, so one tab never loads the other tabs' rows.
export const TABS: [string, Category[]][] = [
  ["Matched", ["matched"]],
  ["Unmatched payments", ["payment_unmatched", "payment_ambiguous"]],
  ["Unmatched bank lines", ["bank_no_payment", "card_no_payment", "duplicate"]],
  ["Amount differences", ["amount_diff"]],
];
const LIMIT = 200; // the API's maximum page; the CSV holds everything

function Rows({ category }: { category: Category }) {
  return (
    <Load<Report> url={`/api/reconciliation?category=${category}&limit=${LIMIT}`}>
      {({ rows, total }) => (
        <>
          <h2>{LABEL[category]} ({total})</h2>
          {rows.length === 0 ? <Empty>Nothing here.</Empty> : (
            <Table>
              <thead><tr><th>Payment</th><th>Invoice</th><th>Vendor</th><th>Method</th><th className="num">Payment</th><th>Statement line</th><th className="num">Line</th><th className="num">Difference</th><th>Why</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.paymentId}-${r.lineId}-${i}`}>
                    {/* Payments have no page of their own and the row has no invoice id, so both link to the payments list. */}
                    <td>{r.paymentId === null ? "—" : <Link href="/payments">Payment {r.paymentId}</Link>}</td>
                    <td>{r.invoiceNumber ? <Link href="/payments">{r.invoiceNumber}</Link> : "—"}</td>
                    <td>{r.vendor ?? "—"}</td><td>{r.method ?? "—"}</td>
                    <td className="num">{money(r.paymentCents, "CAD")}</td>
                    <td>{r.lineText ? `${r.lineSource} ${r.lineDate}: ${r.lineText}` : "—"}</td>
                    <td className="num">{money(r.lineCents, "CAD")}</td><td className="num">{money(r.diffCents, "CAD")}</td><td>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {total > rows.length && <p className="empty">Showing the first {rows.length} of {total}. Download the CSV for all of them.</p>}
        </>
      )}
    </Load>
  );
}

// GET /api/reconciliation (finance_manager, controller_admin, auditor). Any other role gets the server's 403 text.
export default function ReconciliationPage() {
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string>();
  const summary = useApi<Report>("/api/reconciliation?limit=1");
  return (
    <main id="main">
      <h1>Reconciliation</h1>
      <p>Each paid payment is matched against the bank statement and card transactions.</p>
      <button onClick={async () => setError(await download("/api/reconciliation?format=csv", "reconciliation.csv"))}><Icon name="download" />Download CSV</button>
      <Notice error={error} />
      {summary.error ? <p role="alert" className="error-box">{summary.error}</p> : (
        <div className="cards">
          {(Object.keys(LABEL) as Category[]).map((c) => <div key={c} className="card">{LABEL[c]}<strong>{summary.data?.summary[c] ?? "…"}</strong></div>)}
        </div>
      )}
      {!summary.error && (
        <>
          <div role="tablist" className="tabs" aria-label="Reconciliation results">
            {TABS.map(([name], i) => <button key={name} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>{name}</button>)}
          </div>
          {TABS[tab][1].map((c) => <Rows key={c} category={c} />)}
        </>
      )}
    </main>
  );
}

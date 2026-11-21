"use client";
import Link from "next/link";
import { useState } from "react";
import { Empty, SeverityChip, Table, ymd } from "./ui";
import { ConfirmAction, useActions } from "./actions";
import { money, post } from "./api";

// Shape of GET /api/approvals/inbox rows (src/server/views.ts approvalInbox).
export type InboxRow = {
  invoiceId: number; stepNo: number; role: string; reason: string | null; invoiceNumber: string; vendorName: string | null;
  totalCents: number; currency: string; dueDate: string | null; ageDays: number; delegatedFromId: number | null;
  flagCount: number; topFlag: { code: string; severity: string; message: string } | null;
};

export type SortKey = "due" | "age" | "total" | "vendor";
export type FlagFilter = "all" | "flagged" | "clean";
export const SORTS: Record<SortKey, string> = { due: "Due date, soonest first", age: "Age, oldest first", total: "Total, largest first", vendor: "Vendor, A to Z" };

// Missing due dates sort last; invoice id breaks ties so the order never jumps between renders.
const BY: Record<SortKey, (a: InboxRow, b: InboxRow) => number> = {
  due: (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
  age: (a, b) => b.ageDays - a.ageDays,
  total: (a, b) => b.totalCents - a.totalCents,
  vendor: (a, b) => (a.vendorName ?? "").localeCompare(b.vendorName ?? ""),
};
export const sortInbox = (rows: InboxRow[], key: SortKey) => [...rows].sort((a, b) => BY[key](a, b) || a.invoiceId - b.invoiceId);
export const filterInbox = (rows: InboxRow[], f: FlagFilter) => rows.filter((r) => f === "all" || (f === "flagged") === r.flagCount > 0);
// topFlag is the worst flag (the server sorts most severe first), so an error there means a blocking flag somewhere.
export const hasErrorFlag = (r: InboxRow) => r.topFlag?.severity === "error";

// Looks only: the plain name for a role token. The server still decides who may approve.
const ROLE: Record<string, string> = { approver: "Approver", dept_manager: "Department manager", finance_manager: "Finance manager", controller_admin: "Controller", cfo: "CFO" };
const roleName = (r: string) => ROLE[r] ?? (r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, " "));

export function InboxTable({ rows, reload }: { rows: InboxRow[]; reload: () => void }) {
  const [sort, setSort] = useState<SortKey>("due");
  const [show, setShow] = useState<FlagFilter>("all");
  const a = useActions(reload);
  const shown = sortInbox(filterInbox(rows, show), sort);

  return (
    <>
      <form className="inline" onSubmit={(e) => e.preventDefault()}>
        <label>Sort by <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Show <select value={show} onChange={(e) => setShow(e.target.value as FlagFilter)}><option value="all">All</option><option value="flagged">Flagged</option><option value="clean">Clean (no flags)</option></select></label>
      </form>
      {shown.length === 0 ? <Empty href="/invoices" next="Browse all invoices">{rows.length === 0 ? "Nothing is waiting for your approval. Browse all invoices to follow ones you already decided." : "No invoices match this filter. Show All to see everything waiting for you."}</Empty> : (
        <Table>
          <thead><tr><th>Invoice</th><th>Vendor</th><th className="num">Total</th><th>Due</th><th className="num">Age (days)</th><th>Flags</th><th>Why you</th><th>Decision</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.invoiceId}>
                <td><Link href={`/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link></td>
                <td>{r.vendorName ?? "—"}</td>
                <td className="num">{money(r.totalCents, r.currency)}</td>
                <td>{ymd(r.dueDate)}</td>
                <td className="num">{r.ageDays}</td>
                <td>{r.topFlag ? <><strong>{r.flagCount} {r.flagCount === 1 ? "flag" : "flags"}</strong> <SeverityChip severity={r.topFlag.severity} /> {r.topFlag.message}</> : "No flags"}</td>
                <td>{roleName(r.role)}, step {r.stepNo}{r.delegatedFromId ? " (delegated)" : ""}{r.reason ? `: ${r.reason}` : ""}</td>
                <td>
                  {hasErrorFlag(r) ? <Link href={`/invoices/${r.invoiceId}`}>Open to review</Link>
                    : <ConfirmAction icon="approved" label="Approve" busyLabel="Approving…" ariaLabel={`Approve ${r.invoiceNumber}`} busy={a.busyKey === `approve-${r.invoiceId}`} locked={a.locked}
                        title={`Confirm approval of ${r.invoiceNumber}`} facts={[["Amount", money(r.totalCents, r.currency)], ["Vendor", r.vendorName ?? "unknown vendor"]]} confirmLabel={`Approve ${money(r.totalCents, r.currency)}`}
                        onConfirm={(_, key) => a.run(`approve-${r.invoiceId}`, () => post(`/api/invoices/${r.invoiceId}/decision`, { decision: "approved" }, { "idempotency-key": key }), `Approved ${r.invoiceNumber}`)} />}
                  {a.show(`approve-${r.invoiceId}`)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

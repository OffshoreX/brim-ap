"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { INVOICE_STATUSES } from "@/contracts";
import { Empty, STATUS_LABEL, Skeleton, StatusBadge, Table, ymd } from "@/components/ui";
import { money, useApi } from "@/components/api";
import { useCurrentUser } from "@/components/CurrentUser";
import RoleHome from "@/components/RoleHome";
import BatchUpload from "@/components/BatchUpload";
import Pager, { invoicesUrl } from "@/components/Pager";

type Item = { id: number; status: string; vendorId: number | null; invoiceNumber: string; invoiceDate: string; totalCents: number; currency: string };
type Counts = { total: number; byStatus: Record<string, number>; asOf?: string };

// Both the status filter and the page number live in the URL (?status=paid&page=2), so a refresh or a shared link shows the same rows.
function setQuery(status: string, page: number) {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  if (page > 1) q.set("page", String(page));
  window.history.replaceState(null, "", q.size ? `?${q}` : window.location.pathname);
}

// GET /api/invoices?status=&limit=&offset= (newest first, X-Total-Count = the whole list) and /api/invoices/counts. Uploading lives on /upload.
export default function InvoicesPage() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const { role } = useCurrentUser();
  // The dashboard links here with ?status=...; read it on the client (no Suspense needed) and ignore unknown values.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("status");
    const p = Number(q.get("page"));
    if (s && s in STATUS_LABEL && s !== "scheduled") setStatus(s);
    if (Number.isInteger(p) && p > 1) setPage(p);
    setReady(true);
  }, []);
  const go = (s: string, p: number) => { setStatus(s); setPage(p); setQuery(s, p); };

  const counts = useApi<Counts>("/api/invoices/counts").data;
  const list = useApi<Item[]>(ready ? invoicesUrl(status, page) : null);
  const total = list.total ?? 0;

  return (
    <main id="main">
      <h1>Invoices</h1>
      <RoleHome page="/invoices" />
      {role === "employee" ? (
        <section className="panel"><h2>Submit invoice</h2><BatchUpload /></section>
      ) : role && role !== "approver" && role !== "finance_manager" && role !== "auditor" && <p><Link href="/upload">Upload invoices</Link> (many files at once, with a result per file)</p>}
      <label>Status{" "}
        <select value={status} onChange={(e) => go(e.target.value, 1)}>
          <option value="">All{counts && ` (${counts.total})`}</option>
          {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}{counts && ` (${counts.byStatus[s] ?? 0})`}</option>)}
        </select>
      </label>
      {list.error ? <p role="alert" className="error-box">{list.error}</p> : list.data === undefined ? <Skeleton /> : list.data.length === 0 ? (
        <Empty href="/upload" next="Upload an invoice">{total > 0 ? "There are no invoices on this page." : "No invoices match this filter."}</Empty>
      ) : (
        <Table>
          <thead><tr><th>#</th><th>Invoice no.</th><th>Date</th><th>Status</th><th className="num">Total</th></tr></thead>
          <tbody>
            {list.data.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/invoices/${i.id}`}>{i.id}</Link></td>
                <td>{i.invoiceNumber || "(not read yet)"}</td><td>{ymd(i.invoiceDate)}</td><td><StatusBadge status={i.status} /></td>
                <td className="num">{money(i.totalCents, i.currency)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {list.data !== undefined && total > 0 && <Pager page={page} shown={list.data.length} total={total} onPage={(p) => go(status, p)} />}
      {counts?.asOf && <p className="muted">Data as of {counts.asOf}.</p>}
    </main>
  );
}

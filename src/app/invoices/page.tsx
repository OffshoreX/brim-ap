"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { INVOICE_STATUSES } from "@/contracts";
import { Empty, STATUS_LABEL, StatusBadge, Table, ymd } from "@/components/ui";
import { Load, money, useApi } from "@/components/api";
import RoleHome from "@/components/RoleHome";
import BatchUpload from "@/components/BatchUpload";
import type { MeResponse } from "@/contracts";

type Item = { id: number; status: string; vendorId: number | null; invoiceNumber: string; invoiceDate: string; totalCents: number; currency: string };

// GET /api/invoices. Uploading lives on /upload.
export default function InvoicesPage() {
  const [status, setStatus] = useState("");
  const role = useApi<MeResponse>("/api/me").data?.user.role;
  // The dashboard links here with ?status=...; read it on the client (no Suspense needed) and ignore unknown values.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s && s in STATUS_LABEL) setStatus(s);
  }, []);

  return (
    <main id="main">
      <h1>Invoices</h1>
      <RoleHome page="/invoices" />
      {role === "employee" ? (
        <section className="panel"><h2>Submit invoice</h2><BatchUpload /></section>
      ) : role && role !== "approver" && role !== "finance_manager" && role !== "auditor" && <p><Link href="/upload">Upload invoices</Link> (many files at once, with a result per file)</p>}
      <label>Status{" "}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {[...INVOICE_STATUSES, "scheduled"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      <Load<Item[]> url={`/api/invoices`}>
        {(all) => {
          const items = all.filter((i) => !status || i.status === status);
          return items.length === 0 ? <Empty href="/upload" next="Upload an invoice">No invoices match this filter.</Empty> : (
          <Table>
            <thead><tr><th>#</th><th>Invoice no.</th><th>Date</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/invoices/${i.id}`}>{i.id}</Link></td>
                  <td>{i.invoiceNumber || "(not read yet)"}</td><td>{ymd(i.invoiceDate)}</td><td><StatusBadge status={i.status} /></td>
                  <td className="num">{money(i.totalCents, i.currency)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          );
        }}
      </Load>
    </main>
  );
}

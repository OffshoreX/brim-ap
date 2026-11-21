"use client";
import Link from "next/link";
import { useState } from "react";
import { INVOICE_STATUSES } from "@/contracts";
import { Empty, StatusBadge, Table } from "@/components/ui";
import { Load, money } from "@/components/api";

type Item = { id: number; status: string; vendorId: number | null; invoiceNumber: string; invoiceDate: string; totalCents: number; currency: string };

// GET /api/invoices. Uploading lives on /upload.
export default function InvoicesPage() {
  const [status, setStatus] = useState("");

  return (
    <main>
      <h1>Invoices</h1>
      <p><Link href="/upload">Upload invoices</Link> (many files at once, with a result per file)</p>
      <label>Status{" "}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {[...INVOICE_STATUSES, "scheduled"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <Load<Item[]> url={`/api/invoices`}>
        {(all) => {
          const items = all.filter((i) => !status || i.status === status);
          return items.length === 0 ? <Empty>No invoices match. Upload a file above to start.</Empty> : (
          <Table>
            <thead><tr><th>#</th><th>Invoice no.</th><th>Date</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/invoices/${i.id}`}>{i.id}</Link></td>
                  <td>{i.invoiceNumber || "(not read yet)"}</td><td>{i.invoiceDate}</td><td><StatusBadge status={i.status} /></td>
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

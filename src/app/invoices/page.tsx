"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { INVOICE_STATUSES } from "@/contracts";
import { Empty, StatusBadge, Table } from "@/components/ui";
import { call, Load, money } from "@/components/api";

type Item = { id: number; status: string; vendorId: number | null; invoiceNumber: string; invoiceDate: string; totalCents: number; currency: string };
type Uploaded = { invoiceId: number; status: string; duplicate: boolean };

// GET /api/invoices, POST /api/invoices/upload, then POST /api/invoices/{id}/process for each new file.
export default function InvoicesPage() {
  const [status, setStatus] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [version, setVersion] = useState(0);

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLog(["Uploading…"]);
    const up = await call<Uploaded[]>("/api/invoices/upload", { method: "POST", body: form });
    if (!up.data) return setLog([up.error ?? "Upload failed"]);
    const lines: string[] = [];
    // One at a time: each process call reads the file with the model, so keep the load gentle.
    for (const u of up.data) {
      if (u.duplicate) { lines.push(`Invoice ${u.invoiceId}: already uploaded (${u.status}), not processed again`); continue; }
      const p = await call<{ status: string }>(`/api/invoices/${u.invoiceId}/process`, { method: "POST" });
      lines.push(`Invoice ${u.invoiceId}: ${p.data ? `processed, now ${p.data.status}` : `uploaded but not processed. ${p.error}`}`);
      setLog([...lines]);
    }
    setLog(lines);
    setVersion((v) => v + 1);
  }

  return (
    <main>
      <h1>Invoices</h1>
      <form onSubmit={upload} className="inline">
        <input type="file" name="file" multiple accept="application/pdf,image/png,image/jpeg" required aria-label="Invoice files" />
        <button type="submit">Upload and process</button>
      </form>
      <ul aria-live="polite">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <label>Status{" "}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {[...INVOICE_STATUSES, "scheduled"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <Load<Item[]> url={`/api/invoices?v=${version}`}>
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

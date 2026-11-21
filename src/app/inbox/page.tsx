"use client";
import { useState } from "react";
import { Empty, Table } from "@/components/ui";
import { Load, Notice, post } from "@/components/api";

type Imported = { emailId: string; class: string; invoiceIds: number[]; flags: string[]; skipped?: string };
type Other = { emailId: string; from: string; subject: string; receivedAt: string | null; class: string; flags: string[] };

// POST /api/inbox/import (classifies every email, makes invoices from the ones with attachments) and GET /api/inbox/other.
export default function InboxPage() {
  const [imported, setImported] = useState<Imported[]>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  async function run() {
    const r = await post<Imported[]>("/api/inbox/import", {});
    setError(r.error);
    if (r.data) { setImported(r.data); setVersion((v) => v + 1); }
  }

  return (
    <main>
      <h1>Inbox</h1>
      <button onClick={run}>Import inbox</button>
      <Notice error={error} />
      {imported && (
        <>
          <h2>Last import</h2>
          <Table>
            <thead><tr><th>Email</th><th>Class</th><th>Invoices created</th><th>Flags</th></tr></thead>
            <tbody>
              {imported.map((m) => (
                <tr key={m.emailId}><td>{m.emailId}</td><td>{m.skipped ? "already imported" : m.class}</td><td>{m.invoiceIds.join(", ")}</td><td>{m.flags.join(", ")}</td></tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      <h2>Mail that is not an invoice</h2>
      <Load<Other[]> url={`/api/inbox/other?v=${version}`}>
        {(mail) => mail.length === 0 ? <Empty>No other mail in the inbox.</Empty> : (
          <Table>
            <thead><tr><th>From</th><th>Subject</th><th>Received</th><th>Class</th><th>Flags</th></tr></thead>
            <tbody>
              {mail.map((m) => (
                <tr key={m.emailId}><td>{m.from}</td><td>{m.subject}</td><td>{m.receivedAt}</td><td>{m.class}</td><td>{m.flags.join(", ")}</td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Load>
    </main>
  );
}

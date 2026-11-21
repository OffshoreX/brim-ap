"use client";
import Link from "next/link";
import { useState } from "react";
import { Empty, Table } from "@/components/ui";
import { Load, Notice, post } from "@/components/api";

type Imported = { emailId: string; class: string; invoiceIds: number[]; flags: string[]; skipped?: string };
type Other = { emailId: string; from: string; subject: string; receivedAt: string | null; class: string; reason?: string | null; flags: string[] };

// Why each class was chosen, in the words of the keyword rules in src/server/inbox.ts (no model is involved).
const WHY: Record<string, string> = {
  invoice: "Has an attachment and reads like an invoice",
  credit_note: "Has an attachment and reads like a credit note",
  bank_change: "From one known vendor and asks to change bank details",
  suspicious: "Tries to instruct the system",
  statement: "Reads like a statement, not an invoice",
  payment_inquiry: "Asks where a payment is",
  marketing: "Promotional mail",
  invoice_missing_attachment: "Mentions an invoice but has no attachment",
};
const TABS = ["Invoice emails", "Bank-change requests", "Suspicious", "Other"] as const;
type Tab = (typeof TABS)[number];
export const tabOf = (cls: string): Tab =>
  cls === "invoice" || cls === "credit_note" ? "Invoice emails" : cls === "bank_change" ? "Bank-change requests" : cls === "suspicious" ? "Suspicious" : "Other";

// POST /api/inbox/import (classifies every email, makes invoices from the ones with attachments) and GET /api/inbox/other.
// Invoice emails have no list endpoint, so that tab shows the last import run in this session.
export default function InboxPage() {
  const [imported, setImported] = useState<Imported[]>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>("Invoice emails");

  async function run() {
    const r = await post<Imported[]>("/api/inbox/import", {});
    setError(r.error);
    if (r.data) { setImported(r.data); setVersion((v) => v + 1); }
  }
  const mailFor = (mail: Other[], t: Tab) => mail.filter((m) => tabOf(m.class) === t);

  return (
    <main>
      <h1>Inbox</h1>
      <button onClick={run}>Import inbox</button>
      <Notice error={error} />
      <div role="tablist" className="tabs" aria-label="Inbox mail">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "Invoice emails" ? (
        !imported ? <Empty>Run an import to see the invoice emails it found.</Empty> : (
          <Table>
            <thead><tr><th>Email</th><th>Class</th><th>Why</th><th>Invoices</th><th>Flags</th></tr></thead>
            <tbody>
              {imported.filter((m) => tabOf(m.class) === tab).map((m) => (
                <tr key={m.emailId}>
                  <td>{m.emailId}</td><td>{m.skipped ? "already imported" : m.class}</td><td>{WHY[m.class]}</td>
                  <td>{m.invoiceIds.map((id) => <Link key={id} href={`/invoices/${id}`}>Invoice {id} </Link>)}</td><td>{m.flags.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      ) : (
        <Load<Other[]> url={`/api/inbox/other?v=${version}`}>
          {(all) => {
            const mail = mailFor(all, tab);
            return mail.length === 0 ? <Empty>Nothing in this tab.</Empty> : (
              <Table>
                <thead><tr><th>From</th><th>Subject</th><th>Received</th><th>Why</th><th>Link</th></tr></thead>
                <tbody>
                  {mail.map((m) => (
                    <tr key={m.emailId}>
                      <td>{m.from}</td><td>{m.subject}</td><td>{m.receivedAt}</td>
                      <td>{WHY[m.class] ?? m.class}{m.reason && `: ${m.reason}`}</td>
                      {/* The list does not say which vendor sent it, so this goes to the vendor list. */}
                      <td>{m.class === "bank_change" ? <Link href="/vendors">Vendors</Link> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            );
          }}
        </Load>
      )}
    </main>
  );
}

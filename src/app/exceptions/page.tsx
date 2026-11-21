"use client";
import Link from "next/link";
import { useState } from "react";
import { Empty, SeverityChip, Table } from "@/components/ui";
import { Load, money, post, type Flag } from "@/components/api";
import { ActionButton, ConfirmAction, useActions } from "@/components/actions";
import { flagTitle } from "@/components/labels";
import { CAN_CLERK, useCan, useCurrentUser } from "@/components/CurrentUser";

type Item = { id: number; invoiceNumber: string; totalCents: number; currency: string; flags: Flag[] };

// One entry per invoice with all its flags together. `severity` is optional because the server only sends code and
// message today, so the filter keeps an invoice when any flag matches and shows only that invoice's matching flags.
export function filterBySeverity(items: Item[], severity: string) {
  if (!severity) return items;
  return items.flatMap((i) => { const flags = i.flags.filter((f) => f.severity === severity); return flags.length ? [{ ...i, flags }] : []; });
}

function ExceptionRow({ item, done }: { item: Item; done: () => void }) {
  const [note, setNote] = useState("");
  const a = useActions(done); // one request at a time; the result stays beside the buttons until dismissed
  const { role } = useCurrentUser();
  const canResolve = useCan(CAN_CLERK); // looks only: the resolve route checks the role and that the invoice still needs review
  const resolve = (action: "send_to_approval" | "reject", text: string) => a.run(action, () => post(`/api/exceptions/${item.id}/resolve`, { action, note: text }), action === "reject" ? `Rejected invoice ${item.invoiceNumber || item.id}` : `Sent invoice ${item.invoiceNumber || item.id} to approval`);
  const name = item.invoiceNumber || String(item.id);
  return (
    <tr>
      <td><Link href={`/invoices/${item.id}`}>{item.invoiceNumber || item.id}</Link></td>
      <td className="num">{money(item.totalCents, item.currency)}</td>
      <td>
        <ul className="flags">{item.flags.map((f, i) => <li key={i}>{f.severity && <SeverityChip severity={f.severity} />} <strong>{flagTitle(f.code)}:</strong> {f.message}</li>)}</ul>
      </td>
      <td>
        {role && !canResolve ? <p className="muted">Only AP clerks, finance managers and controllers can resolve this.</p> : canResolve && <>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for approval (required)" aria-label={`Note for invoice ${item.id}`} />
        <ActionButton icon="approved" label="Send to approval" busyLabel="Sending…" ariaLabel={`Send invoice ${name} to approval`} busy={a.busyKey === "send_to_approval"} locked={a.locked}
          onClick={() => note.trim() ? resolve("send_to_approval", note.trim()) : a.fail("send_to_approval", "Write a note first: it goes in the audit log.")} />
        <ConfirmAction secondary icon="rejected" label="Reject" busyLabel="Rejecting…" ariaLabel={`Reject invoice ${name}`} busy={a.busyKey === "reject"} locked={a.locked}
          title="Confirm rejection" ask={{ label: "Reason for rejecting", required: true }} facts={[["Invoice", name], ["Total", money(item.totalCents, item.currency)]]} confirmLabel={`Reject invoice ${name}`}
          onConfirm={(text) => resolve("reject", text)} />
        {a.show("send_to_approval")}{a.show("reject")}
        </>}
      </td>
    </tr>
  );
}

// GET /api/exceptions, POST /api/exceptions/{id}/resolve (the server checks the role and that the invoice still needs review).
export default function ExceptionsPage() {
  const [severity, setSeverity] = useState("");
  return (
    <main id="main">
      <h1>Exceptions</h1>
      <label>Severity{" "}
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All</option>
          <option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option>
        </select>
      </label>
      <Load<Item[]> url="/api/exceptions">
        {(items, reload) => {
          const shown = filterBySeverity(items, severity);
          return items.length === 0 ? <Empty href="/invoices" next="Browse all invoices">Nothing needs review right now.</Empty> : shown.length === 0 ? <p>No flags at this severity.</p> : (
            <Table>
              <thead><tr><th>Invoice</th><th className="num">Total</th><th>Why flagged</th><th>Resolve</th></tr></thead>
              <tbody>{shown.map((i) => <ExceptionRow key={i.id} item={i} done={reload} />)}</tbody>
            </Table>
          );
        }}
      </Load>
    </main>
  );
}

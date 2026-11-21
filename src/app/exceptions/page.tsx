"use client";
import Link from "next/link";
import { useState } from "react";
import { SeverityChip, Table } from "@/components/ui";
import { FLAG_TITLE, Load, money, Notice, post, type Flag } from "@/components/api";

type Item = { id: number; invoiceNumber: string; totalCents: number; currency: string; flags: Flag[] };

// One group per flag code; an invoice with two flags shows under both. `severity` is optional because
// the server only sends code and message today (see PR), so the filter only narrows flags that carry one.
export function groupByCode(items: Item[], severity: string) {
  const groups = new Map<string, { code: string; severity?: string; items: Item[] }>();
  for (const item of items)
    for (const f of item.flags) {
      if (severity && f.severity !== severity) continue;
      const g = groups.get(f.code) ?? { code: f.code, severity: f.severity, items: [] };
      if (!g.items.includes(item)) g.items.push(item);
      groups.set(f.code, g);
    }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

function ExceptionRow({ item, done }: { item: Item; done: () => void }) {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  async function resolve(action: "send_to_approval" | "reject") {
    if (!note.trim()) return setMsg({ error: "Write a note first: it goes in the audit log." });
    const r = await post(`/api/exceptions/${item.id}/resolve`, { action, note: note.trim() });
    if (r.error) setMsg({ error: r.error });
    else done();
  }
  return (
    <tr>
      <td><Link href={`/invoices/${item.id}`}>{item.invoiceNumber || item.id}</Link></td>
      <td className="num">{money(item.totalCents, item.currency)}</td>
      <td>{item.flags.map((f) => (FLAG_TITLE[f.code] ? `${FLAG_TITLE[f.code]}: ${f.message}` : f.message)).join("; ")}</td>
      <td>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required)" aria-label={`Note for invoice ${item.id}`} />
        <button onClick={() => resolve("send_to_approval")}>Send to approval</button>
        <button onClick={() => resolve("reject")}>Reject</button>
        <Notice {...msg} />
      </td>
    </tr>
  );
}

// GET /api/exceptions, POST /api/exceptions/{id}/resolve (the server checks the role and that the invoice still needs review).
export default function ExceptionsPage() {
  const [severity, setSeverity] = useState("");
  return (
    <main>
      <h1>Exceptions</h1>
      <label>Severity{" "}
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All</option>
          <option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option>
        </select>
      </label>
      <Load<Item[]> url="/api/exceptions">
        {(items, reload) => {
          const groups = groupByCode(items, severity);
          return items.length === 0 ? <p>Nothing needs review right now.</p> : groups.length === 0 ? <p>No flags at this severity.</p> : (
            <>
              {groups.map((g) => (
                <section key={g.code}>
                  <h2><code>{g.code}</code> {FLAG_TITLE[g.code] && <>{FLAG_TITLE[g.code]} </>}{g.severity && <SeverityChip severity={g.severity} />} <small>({g.items.length})</small></h2>
                  <Table>
                    <thead><tr><th>Invoice</th><th className="num">Total</th><th>Why flagged</th><th>Resolve</th></tr></thead>
                    <tbody>{g.items.map((i) => <ExceptionRow key={i.id} item={i} done={reload} />)}</tbody>
                  </Table>
                </section>
              ))}
            </>
          );
        }}
      </Load>
    </main>
  );
}

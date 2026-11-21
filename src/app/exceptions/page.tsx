"use client";
import Link from "next/link";
import { useState } from "react";
import { Table } from "@/components/ui";
import { Flags, Load, money, Notice, post, type Flag } from "@/components/api";

type Item = { id: number; invoiceNumber: string; totalCents: number; currency: string; flags: Flag[] };

function ExceptionRow({ item, done }: { item: Item; done: () => void }) {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  async function resolve(action: "send_to_approval" | "reject") {
    const r = await post(`/api/exceptions/${item.id}/resolve`, { action, note });
    if (r.error) setMsg({ error: r.error });
    else done();
  }
  return (
    <tr>
      <td><Link href={`/invoices/${item.id}`}>{item.invoiceNumber || item.id}</Link></td>
      <td className="num">{money(item.totalCents, item.currency)}</td>
      <td><Flags flags={item.flags} /></td>
      <td>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" aria-label={`Note for invoice ${item.id}`} />
        <button onClick={() => resolve("send_to_approval")}>Send to approval</button>
        <button onClick={() => resolve("reject")}>Reject</button>
        <Notice {...msg} />
      </td>
    </tr>
  );
}

// GET /api/exceptions, POST /api/exceptions/{id}/resolve
export default function ExceptionsPage() {
  return (
    <main>
      <h1>Exceptions</h1>
      <Load<Item[]> url="/api/exceptions">
        {(items, reload) =>
          items.length === 0 ? <p>Nothing needs review right now.</p> : (
            <Table>
              <thead><tr><th>Invoice</th><th className="num">Total</th><th>Why flagged</th><th>Resolve</th></tr></thead>
              <tbody>{items.map((i) => <ExceptionRow key={i.id} item={i} done={reload} />)}</tbody>
            </Table>
          )
        }
      </Load>
    </main>
  );
}

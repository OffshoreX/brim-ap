"use client";
import { useState, type FormEvent } from "react";
import { Empty, Table } from "@/components/ui";
import { Load } from "@/components/api";
import RoleHome from "@/components/RoleHome";

type Row = { id: number; at: string; actorId: number | null; action: string; entity: string; entityId: string | null; before: unknown; after: unknown };

// GET /api/audit?entity=&actor=&from=&to=&limit=
export default function AuditPage() {
  const [query, setQuery] = useState("");
  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(e.currentTarget)) if (v !== "") q.set(k, String(v));
    setQuery(q.toString());
  }
  return (
    <main>
      <h1>Audit log</h1>
      <RoleHome page="/audit" />
      <form onSubmit={apply} className="inline">
        <input name="entity" placeholder="Entity (invoice, payment…)" aria-label="Entity" />
        <input name="actor" type="number" min="1" placeholder="Actor id" aria-label="Actor id" />
        <label>From <input name="from" type="date" /></label>
        <label>To <input name="to" type="date" /></label>
        <input name="limit" type="number" min="1" max="500" placeholder="Limit" aria-label="Limit" />
        <button type="submit">Filter</button>
      </form>
      <Load<Row[]> url={`/api/audit?${query}`}>
        {(rows) => rows.length === 0 ? <Empty>No audit entries match this filter.</Empty> : (
          <Table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Entity</th><th>Before</th><th>After</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td>{r.at}</td><td>{r.actorId ?? "system"}</td><td>{r.action}</td><td>{r.entity} {r.entityId}</td>
                  <td><code>{JSON.stringify(r.before)}</code></td><td><code>{JSON.stringify(r.after)}</code></td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Load>
    </main>
  );
}

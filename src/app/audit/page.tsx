"use client";
import { useState, type FormEvent } from "react";
import { Empty } from "@/components/ui";
import { AuditTable } from "@/components/AuditTable";
import type { AuditRow } from "@/components/AuditTable";
import { Load } from "@/components/api";
import RoleHome from "@/components/RoleHome";

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
    <main id="main">
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
      <Load<AuditRow[]> url={`/api/audit?${query}`}>
        {(rows) => rows.length === 0 ? <Empty href="/audit" next="Clear the filter">No audit entries match this filter.</Empty> : (
          <AuditTable rows={rows} entity />
        )}
      </Load>
    </main>
  );
}

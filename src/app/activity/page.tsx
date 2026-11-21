"use client";
import { useState } from "react";
import { Load } from "@/components/api";
import { StepsTable, STEP_STATUSES, stepStatusWord, type StepRow } from "@/components/ProcessSteps";
import { Empty } from "@/components/ui";

// GET /api/process-log?limit=100: the latest steps across invoices, newest first. The server limits it to clerks, finance managers, controllers and auditors.
// The endpoint has no status filter, so the filter works on the 100 rows already loaded.
export default function ActivityPage() {
  const [status, setStatus] = useState("");
  return (
    <main id="main">
      <h1>Activity</h1>
      <p className="muted">The latest 100 processing steps, newest first. Each row is one check the system ran on an invoice.</p>
      <Load<StepRow[]> url="/api/process-log?limit=100">
        {(all) => {
          const rows = status ? all.filter((r) => r.status === status) : all;
          return (
            <>
              <form className="inline" onSubmit={(e) => e.preventDefault()}>
                <label>Status
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All</option>
                    {STEP_STATUSES.map((s) => <option key={s} value={s}>{stepStatusWord(s)}</option>)}
                  </select>
                </label>
              </form>
              {all.length === 0 ? <Empty href="/upload" next="Upload an invoice">No processing steps yet. Upload an invoice and its steps will appear here.</Empty>
                : rows.length === 0 ? <Empty>No steps with this status among the latest {all.length}.</Empty>
                : <StepsTable rows={rows} withInvoice />}
            </>
          );
        }}
      </Load>
    </main>
  );
}

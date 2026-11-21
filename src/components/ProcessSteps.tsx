"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { call, LoadError } from "./api";
import { Icon, type IconName } from "./icons";
import { stepName } from "./labels";
import { Empty, Skeleton, Table } from "./ui";

// Same shape as ProcessStep in src/server/processLog.ts; the cross-invoice endpoint adds the invoice.
export type StepStatus = "ok" | "flagged" | "failed" | "skipped";
export type StepRow = { id: number; step: string; status: StepStatus; detail: string; durationMs: number; createdAt: string; invoiceId?: number; invoiceNumber?: string };

// Colour AND icon AND word. Reuses the existing badge colours: ok is green, flagged amber, failed red, skipped grey.
const STATUS: Record<StepStatus, { word: string; icon: IconName; css: string }> = {
  ok: { word: "OK", icon: "approved", css: "badge-approved" },
  flagged: { word: "Flagged", icon: "warning", css: "badge-needs_review" },
  failed: { word: "Failed", icon: "error", css: "badge-rejected" },
  skipped: { word: "Skipped", icon: "info", css: "badge-unknown" },
};
export const STEP_STATUSES = Object.keys(STATUS) as StepStatus[];
export const stepStatusWord = (s: string) => STATUS[s as StepStatus]?.word ?? s;

export function StepBadge({ status }: { status: string }) {
  const s = STATUS[status as StepStatus];
  return s ? <span className={`badge ${s.css}`}><Icon name={s.icon} />{s.word}</span> : <span className="badge badge-unknown">{status}</span>;
}

const at = (s: string) => s.replace("T", " ").slice(0, 19);
export const took = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

// A flagged or failed row says why, in words, right in the row (never a tooltip).
export function StepsTable({ rows, withInvoice }: { rows: StepRow[]; withInvoice?: boolean }) {
  return (
    <Table>
      <thead><tr><th>Time</th>{withInvoice && <th>Invoice</th>}<th>Step</th><th>Status</th><th>What happened</th><th className="num">Took</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="nowrap">{at(r.createdAt)}</td>
            {withInvoice && <td className="nowrap"><Link href={`/invoices/${r.invoiceId}`}>{r.invoiceNumber ? `Invoice ${r.invoiceNumber}` : `Invoice ${r.invoiceId}`}</Link></td>}
            <td>{stepName(r.step)}</td>
            <td><StepBadge status={r.status} /></td>
            <td>{(r.status === "flagged" || r.status === "failed") && <strong>Reason: </strong>}{r.detail}</td>
            <td className="num">{took(r.durationMs)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// A status past "received" means the pipeline has finished with the invoice (needs_review, pending_approval, or a later one for a file seen before).
export const isFinal = (status: string) => status !== "received";
const MAX_POLLS = 60; // gives up after about a minute so a stuck invoice cannot poll forever

type Follow = {
  getSteps: () => Promise<StepRow[] | string>; // the rows, or an error message
  getStatus: () => Promise<string | undefined>;
  wait: (ms: number) => Promise<void>;
  onSteps: (rows: StepRow[]) => void;
  onError: (message: string) => void;
  cancelled: () => boolean;
};

// Reads the steps once a second until the invoice has left "received", with one last read after it has so no step is missed.
export async function followSteps(status: string, d: Follow) {
  for (let n = 0; n < MAX_POLLS && !d.cancelled(); n++) {
    const rows = await d.getSteps();
    if (d.cancelled()) return;
    if (typeof rows === "string") d.onError(rows);
    else d.onSteps(rows);
    if (isFinal(status)) return;
    await d.wait(1000);
    status = (await d.getStatus()) ?? status;
  }
}

// `status` is the invoice's status when the upload answered; the steps stay on screen once polling stops.
export function InvoiceSteps({ invoiceId, status }: { invoiceId: number; status: string }) {
  const [rows, setRows] = useState<StepRow[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let off = false;
    followSteps(status, {
      getSteps: async () => { const r = await call<StepRow[]>(`/api/invoices/${invoiceId}/process-log`); return r.error ?? r.data ?? []; },
      getStatus: async () => (await call<{ status: string }>(`/api/invoices/${invoiceId}`)).data?.status,
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      onSteps: (r) => { setRows(r); setError(undefined); },
      onError: setError,
      cancelled: () => off,
    });
    return () => { off = true; };
  }, [invoiceId, status]);
  return (
    <div aria-live="polite">
      {error && <LoadError url={`/api/invoices/${invoiceId}/process-log`} error={error} />}
      {!rows ? (error ? null : <Skeleton rows={2} />) : rows.length === 0 ? <Empty>No steps have been written yet.</Empty> : <StepsTable rows={rows} />}
    </div>
  );
}

"use client";
import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { Empty, StatusBadge, Table } from "./ui";
import { Icon } from "./icons";
import { Flags, sendFile, type Flag } from "./api";
import { InvoiceSteps } from "./ProcessSteps";

// Same shape as FileResult in src/server/upload.ts. `duplicate` is optional: the server does not send it yet (see PR).
export type FileResult = { file: string; invoiceId: number | null; status: string; flags: Flag[]; error: string | null; duplicate?: boolean };
export type Row = { name: string; state: "queued" | "uploading" | "processing" | "done" | "failed"; result?: FileResult; error?: string };

const AT_A_TIME = 3; // matches the server's own limit, so we never queue more than it will run
const STATE_LABEL = { queued: "Queued", uploading: "Uploading…", processing: "Processing…", done: "Done", failed: "Failed" };

// One request per file so each row has its own live state; a failed file never stops the others.
export async function runBatch(files: File[], update: (i: number, row: Partial<Row>) => void) {
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      update(i, { state: "uploading" });
      const r = await sendFile<{ results: FileResult[] }>(files[i], () => update(i, { state: "processing" }));
      const result = r.data?.results?.[0];
      if (!result) update(i, { state: "failed", error: r.error ?? "No result returned" });
      else update(i, { state: result.invoiceId === null || result.error ? "failed" : "done", result, error: result.error ?? undefined });
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_A_TIME, files.length) }, worker));
}

export default function BatchUpload() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function start(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0 || busy) return;
    setBusy(true);
    setRows(files.map((f) => ({ name: f.name, state: "queued" })));
    await runBatch(files, (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))));
    setBusy(false);
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); start(e.dataTransfer.files); };

  return (
    <>
      <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <p><Icon name="upload" /> Drag invoice files here, or</p>
        <input ref={input} type="file" multiple accept="application/pdf,image/png,image/jpeg" disabled={busy}
          aria-label="Invoice files" onChange={(e) => { start(e.target.files ?? []); e.target.value = ""; }} />
      </div>
      {rows.length === 0 ? <Empty href="/invoices" next="See existing invoices">No files yet. Each file gets its own row and result.</Empty> : (
        <Table>
          <thead><tr><th>File</th><th>Progress</th><th>Invoice</th><th>Status</th><th>Flags</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td aria-live="polite">{STATE_LABEL[r.state]}{r.result?.duplicate && " · already uploaded"}</td>
                <td>{r.result?.invoiceId != null ? <Link href={`/invoices/${r.result.invoiceId}`}>Invoice {r.result.invoiceId}</Link> : "—"}</td>
                <td>{r.result && r.result.invoiceId !== null ? <StatusBadge status={r.result.status} /> : "—"}</td>
                <td>{r.error ? <p role="alert" className="error">{r.error}</p> : r.result ? <Flags flags={r.result.flags} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {rows.map((r, i) => r.result?.invoiceId != null && (
        <section key={i} aria-label={`Processing steps for ${r.name}`}>
          <h2>Steps for {r.name}</h2>
          <InvoiceSteps invoiceId={r.result.invoiceId} status={r.result.status} />
        </section>
      ))}
    </>
  );
}

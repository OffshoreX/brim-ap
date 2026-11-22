import { useEffect, useRef, useState, type DragEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { Forbidden } from "@/components/States";
import { StatusPill } from "@/components/StatusPill";
import { ProcessSteps } from "@/components/ProcessSteps";
import { Button } from "@/components/ui/button";
import { useInvoiceProcessLog } from "@/hooks/queries";
import { api, errorText } from "@/lib/api";
import { can } from "@/lib/roles";
import { pageHead } from "@/lib/seo";
import { cn } from "@/lib/utils";
import type { Me, UploadFileResult } from "@/lib/types";

export const Route = createFileRoute("/upload")({
  ssr: false,
  head: () => pageHead("Upload invoices", "Drop PDF or image invoices and watch them get processed."),
  component: () => <AppShell>{(me) => <UploadPage me={me} />}</AppShell>,
});

// state: waiting for its turn, in flight (steps appear live), finished, or refused. invoiceId is set as soon as the server has made the invoice.
type Row = { key: string; name: string; state: "queued" | "uploading" | "done" | "error"; error?: string; invoiceId?: number; result?: UploadFileResult };
const POLL_MS = 700;

function UploadPage({ me }: { me: Me }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const qc = useQueryClient();
  if (!can(me.role, "upload")) return <Forbidden />;

  const patch = (key: string, p: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));

  // One file at a time: the server makes the invoice row before it runs the pipeline, so the newest invoice id that appears while
  // this file is in flight is this file's invoice. Sending files in parallel would make that guess ambiguous.
  async function send(row: Row, file: File) {
    patch(row.key, { state: "uploading" });
    const before = await api.newestInvoiceId().catch(() => 0);
    const timer = setInterval(() => {
      api.newestInvoiceId().then((id) => { if (id > before) patch(row.key, { invoiceId: id }); }).catch(() => undefined);
    }, POLL_MS);
    try {
      // POST /api/invoices/upload (multipart). The server's own words are shown if it refuses the file.
      const result = await api.upload(file);
      patch(row.key, { state: "done", invoiceId: result.invoiceId, result });
    } catch (e) {
      patch(row.key, { state: "error", error: errorText(e) });
    } finally {
      clearInterval(timer);
      for (const k of ["invoices", "invoice-counts", "dashboard", "exceptions", "approvals"]) void qc.invalidateQueries({ queryKey: [k] });
    }
  }
  function addFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      const row: Row = { key: crypto.randomUUID(), name: f.name, state: "queued" };
      setRows((r) => [row, ...r]);
      queue.current = queue.current.then(() => send(row, f));
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer.files);
  }

  return (
    <>
      <PageHeader title="Upload invoices" subtitle="PDF, PNG, JPG or WebP. Each file becomes an invoice and is processed automatically." />
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        className={cn("flex flex-col items-center gap-3 surface rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors", over ? "border-primary bg-accent" : "border-border")}>
        <FileUp className="h-8 w-8 text-primary" aria-hidden />
        <p className="text-lg font-semibold">Drag and drop invoice files here</p>
        <p className="text-sm text-muted-foreground">or</p>
        <Button onClick={() => input.current?.click()}>Choose files</Button>
        <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>
      {rows.length > 0 && (
        <div className="mt-6 space-y-4">
          {rows.map((r) => <UploadRow key={r.key} row={r} />)}
        </div>
      )}
    </>
  );
}

function UploadRow({ row }: { row: Row }) {
  const r = row.result;
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">{row.name}</p>
        {row.state === "queued" && <StatusPill status="waiting" />}
        {row.state === "uploading" && <StatusPill status="running" />}
        {row.state === "error" && <StatusPill status="error" />}
        {row.state === "done" && <StatusPill status={r?.status ?? "received"} />}
      </div>
      {row.state === "uploading" && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" /></div>}
      {row.error && <p role="alert" className="mt-2 text-sm font-medium text-bad-foreground">{row.error}</p>}
      {r?.error && <p role="alert" className="mt-2 text-sm font-medium text-bad-foreground">{r.error}</p>}
      {row.invoiceId !== undefined && <LiveSteps id={row.invoiceId} running={row.state === "uploading"} />}
      {r && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {r.flags.length > 0 && <span className="text-sm text-muted-foreground">{r.flags.map((f) => f.message).join("; ")}</span>}
          <Link to="/invoices/$id" params={{ id: String(r.invoiceId) }} className="text-sm font-semibold text-primary hover:underline">Open invoice →</Link>
        </div>
      )}
    </Panel>
  );
}

// GET /api/invoices/:id/process-log, every POLL_MS while the upload is still running, then once more when it ends.
function LiveSteps({ id, running }: { id: number; running: boolean }) {
  const log = useInvoiceProcessLog(String(id), running ? POLL_MS : false);
  const { refetch } = log;
  useEffect(() => { if (!running) void refetch(); }, [running, refetch]);
  return (
    <div className="mt-4 border-t border-border pt-3">
      {log.error ? <p className="text-sm text-muted-foreground">{errorText(log.error)}</p>
        : log.data && log.data.length > 0 ? <ProcessSteps steps={log.data} />
        : <p className="text-sm text-muted-foreground">{running ? "Waiting for the first step…" : "No processing steps were recorded."}</p>}
    </div>
  );
}

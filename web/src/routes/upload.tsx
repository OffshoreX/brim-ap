import { useRef, useState, type DragEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { Forbidden } from "@/components/States";
import { StatusPill } from "@/components/StatusPill";
import { ProcessSteps } from "@/components/ProcessSteps";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/roles";
import { pageHead } from "@/lib/seo";
import { cn } from "@/lib/utils";
import type { Me } from "@/lib/types";

export const Route = createFileRoute("/upload")({
  ssr: false,
  head: () => pageHead("Upload invoices", "Drop PDF or PNG invoices and watch them get processed."),
  component: () => <AppShell>{(me) => <UploadPage me={me} />}</AppShell>,
});

type Row = { key: string; name: string; state: "uploading" | "done" | "error"; error?: string; invoiceId?: string };
const ACCEPT = ["application/pdf", "image/png"];

function UploadPage({ me }: { me: Me }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  if (!can(me.role, "upload")) return <Forbidden />;

  function patch(key: string, p: Partial<Row>) {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));
  }
  // POST /api/invoices/upload (multipart)
  function addFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      const key = crypto.randomUUID();
      if (!ACCEPT.includes(f.type)) {
        setRows((r) => [{ key, name: f.name, state: "error", error: "Only PDF or PNG files can be uploaded." }, ...r]);
        continue;
      }
      setRows((r) => [{ key, name: f.name, state: "uploading" }, ...r]);
      api.upload(f)
        .then((inv) => { patch(key, { state: "done", invoiceId: inv.id }); void qc.invalidateQueries({ queryKey: ["invoices"] }); })
        .catch((e: Error) => patch(key, { state: "error", error: e.message }));
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer.files);
  }

  return (
    <>
      <PageHeader title="Upload invoices" subtitle="PDF or PNG. Each file becomes an invoice and is processed automatically." />
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        className={cn("flex flex-col items-center gap-3 surface rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors", over ? "border-primary bg-accent" : "border-border")}>
        <FileUp className="h-8 w-8 text-primary" aria-hidden />
        <p className="text-lg font-semibold">Drag and drop invoice files here</p>
        <p className="text-sm text-muted-foreground">or</p>
        <Button onClick={() => input.current?.click()}>Choose files</Button>
        <input ref={input} type="file" multiple accept=".pdf,.png,application/pdf,image/png" className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
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
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">{row.name}</p>
        {row.state === "uploading" && <StatusPill status="running" />}
        {row.state === "error" && <StatusPill status="error" />}
        {row.state === "done" && <StatusPill status="received" />}
      </div>
      {row.state === "uploading" && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" /></div>}
      {row.error && <p role="alert" className="mt-2 text-sm font-medium text-bad-foreground">{row.error}</p>}
      {row.invoiceId && <LiveSteps id={row.invoiceId} />}
    </Panel>
  );
}

const DONE = ["needs_review", "pending_approval"];
// Polls GET /api/invoices/:id and GET /api/invoices/:id/process-log every 1s until processing finishes.
function LiveSteps({ id }: { id: string }) {
  const inv = useQuery({ queryKey: ["invoice", id], queryFn: () => api.invoice(id), refetchInterval: (q) => (q.state.data && DONE.includes(q.state.data.status) ? false : 1000) });
  const finished = !!inv.data && DONE.includes(inv.data.status);
  const log = useQuery({ queryKey: ["invoice", id, "process-log"], queryFn: () => api.invoiceProcessLog(id), refetchInterval: finished ? false : 1000, retry: false });
  return (
    <div className="mt-4 border-t border-border pt-3">
      {log.error ? (
        <p className="text-sm text-muted-foreground">{log.error instanceof ApiError && log.error.status === 404 ? "Processing details are not available yet." : log.error.message}</p>
      ) : log.data ? <ProcessSteps steps={log.data} /> : <p className="text-sm text-muted-foreground">Waiting for processing…</p>}
      {finished && inv.data && (
        <div className="mt-3 flex items-center gap-3">
          <StatusPill status={inv.data.status} />
          <Link to="/invoices/$id" params={{ id }} className="text-sm font-semibold text-primary hover:underline">Open {inv.data.invoiceNumber} →</Link>
        </div>
      )}
    </div>
  );
}

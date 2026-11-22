import { createHash } from "node:crypto";
import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { idempotentAsync } from "./idempotency";
import { inspectUpload, storeUpload, UploadError } from "./files";
import { processInvoice } from "./pipeline";
import type { Finding } from "./rules/types";

// Response types live here, not in contracts.ts (lead-owned).
// status is the invoice's status, or "error" when the file never became an invoice (then invoiceId is null).
export type FileResult = { file: string; invoiceId: number | null; status: string; flags: Finding[]; error: string | null };
export type UploadResponse = { results: FileResult[] };

const MAX_CONCURRENT = 3; // keeps the model API and SQLite from being hammered

// Flags are stored as Finding[]; mail imports store plain strings, which are shown as warnings.
function readFlags(json: string): Finding[] {
  try {
    return (JSON.parse(json) as (Finding | string)[]).map((f) => (typeof f === "string" ? { code: f, message: f, severity: "warning" as const } : f));
  } catch {
    return [];
  }
}

// Sync on purpose: store, look up by content hash and insert with no await between, so two copies of
// the same bytes in one batch can never both create a row. Throws UploadError for a bad file.
export function registerUpload(user: User, bytes: Buffer): { invoiceId: number; status: string; isNew: boolean } {
  const { sha, ext } = inspectUpload(bytes);
  const db = getDb();
  // IMMEDIATE: the lookup and the insert hold the write lock, so two processes cannot both miss and both insert.
  return db.transaction(() => {
    const sourceFile = storeUpload(bytes, `${sha}.${ext}`);
    const existing = db.prepare("SELECT id, status FROM invoices WHERE source_file = ?").get(sourceFile) as { id: number; status: string } | undefined;
    if (existing) {
      writeAudit({ actorId: user.id, action: "invoice.reuploaded", entity: "invoice", entityId: existing.id, after: { sourceFile } });
      return { invoiceId: existing.id, status: existing.status, isNew: false };
    }
    // Extraction fills these later; the columns are NOT NULL so empty/zero stand in until then.
    const id = Number(
      db.prepare("INSERT INTO invoices (status, invoice_number, invoice_date, total_cents, currency, requester_id, source_file) VALUES ('received','','',0,'CAD',?,?)").run(user.id, sourceFile).lastInsertRowid
    );
    writeAudit({ actorId: user.id, action: "invoice.upload", entity: "invoice", entityId: id, before: null, after: { status: "received", sourceFile } });
    return { invoiceId: id, status: "received", isNew: true };
  }).immediate();
}

const snapshot = (invoiceId: number) => {
  const row = getDb().prepare("SELECT status, flags FROM invoices WHERE id = ?").get(invoiceId) as { status: string; flags: string };
  return { status: row.status, flags: readFlags(row.flags) };
};

// Invoices being processed right now, so a second copy of the same bytes waits for the first instead of reporting "received".
const inFlight = new Map<number, Promise<FileResult>>();

async function runPipeline(user: User, file: string, invoiceId: number): Promise<FileResult> {
  try {
    const r = await processInvoice(invoiceId, user.id);
    return { file, invoiceId, status: r.status, flags: r.flags, error: null };
  } catch (e) {
    // The invoice exists and stays where it got to, so nothing is lost. The cause is only logged: it may carry SQL or paths.
    console.error("Invoice processing failed:", e);
    return { file, invoiceId, ...snapshot(invoiceId), error: "Processing failed. The invoice was saved; try again or ask an engineer." };
  }
}

// One file, start to finish. Never throws: whatever goes wrong becomes this file's result.
async function handleFile(user: User, file: string, bytes: Buffer): Promise<FileResult> {
  let reg: ReturnType<typeof registerUpload>;
  try {
    reg = registerUpload(user, bytes);
  } catch (e) {
    if (!(e instanceof UploadError)) console.error("Could not store upload:", e);
    return { file, invoiceId: null, status: "error", flags: [], error: e instanceof UploadError ? e.message : "Could not store the file" };
  }
  if (reg.isNew) {
    const run = runPipeline(user, file, reg.invoiceId);
    inFlight.set(reg.invoiceId, run);
    try {
      return await run;
    } finally {
      inFlight.delete(reg.invoiceId);
    }
  }
  // Same bytes seen before: report what is already there (once any run in progress has finished), process nothing.
  const running = inFlight.get(reg.invoiceId);
  if (running) return { ...(await running), file };
  return { file, invoiceId: reg.invoiceId, ...snapshot(reg.invoiceId), error: null };
}

// Runs the files through handleFile, at most MAX_CONCURRENT at a time; results keep the input order.
// The same Idempotency-Key (and the same files) returns the first response instead of processing again.
export function uploadAndProcess(user: User, files: { name: string; bytes: Buffer }[], key?: string | null): Promise<UploadResponse> {
  const request = files.map((f) => [f.name, createHash("sha256").update(f.bytes).digest("hex")]);
  return idempotentAsync(user.id, "invoice.upload", key, request, () => processFiles(user, files));
}

async function processFiles(user: User, files: { name: string; bytes: Buffer }[]): Promise<UploadResponse> {
  if (files.length === 0) throw new UploadError("No files uploaded");
  const results: FileResult[] = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      results[i] = await handleFile(user, files[i].name, files[i].bytes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, files.length) }, worker));
  return { results };
}

import type { User } from "@/contracts";
import { getDb } from "./db";
import type { Finding } from "./rules/types";
import { ViewError, visibleSql } from "./views";

// Processing log (T71): one row per pipeline step per invoice. Derived work only: nothing here is read back by a rule,
// and a failed write is swallowed so logging can never fail or change an invoice.
export type StepStatus = "ok" | "flagged" | "failed" | "skipped";
type Db = ReturnType<typeof getDb>;

const MAX_DETAIL = 300;

// Defence in depth: details are built from fixed sentences and rule messages, but a key-shaped string or the live key is
// removed anyway, and the length is capped.
export function scrub(text: string): string {
  let t = text.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[removed]");
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) t = t.split(key).join("[removed]");
  return t.length > MAX_DETAIL ? `${t.slice(0, MAX_DETAIL - 1)}…` : t;
}

// Never throws. The insert joins the caller's transaction, so a rolled-back run leaves no rows either.
export function writeStep(db: Db, invoiceId: number, step: string, status: StepStatus, detail: string, durationMs: number) {
  try {
    db.prepare("INSERT INTO process_log (invoice_id, step, status, detail, duration_ms) VALUES (?,?,?,?,?)").run(invoiceId, step, status, scrub(detail), Math.max(0, Math.round(durationMs)));
  } catch (e) {
    console.warn("process_log write failed:", e instanceof Error ? e.message : "unknown error");
  }
}

// What a step that raised flags looks like in the log: the flag messages, or the success sentence when there are none.
export function writeFindings(db: Db, invoiceId: number, step: string, findings: Finding[], okDetail: string, durationMs: number) {
  // Text copied from the document is data, so it is not repeated here (the flag itself still shows it to the clerk).
  const say = (f: Finding) => (f.code === "document_contains_instructions" ? "The document contained instructions, which were ignored" : f.message);
  if (findings.length === 0) writeStep(db, invoiceId, step, "ok", okDetail, durationMs);
  else writeStep(db, invoiceId, step, "flagged", findings.map(say).join("; "), durationMs);
}

// The extractor's reason can quote the model or the file, so it is never copied; it is only sorted into a fixed sentence.
const SCHEMA_FAILURE = /^(bad amount|amount too large|bad quantity|not a JSON object|no line items|currency must be|credit note must|cached answer invalid|.+ (missing|must be|is not a valid date))/;
export function extractionFailure(reason: string): string {
  if (SCHEMA_FAILURE.test(reason)) return "The extracted data failed schema validation, so the invoice goes to needs review";
  if (reason.startsWith("model output was not valid JSON")) return "The model answer was not valid JSON, so the invoice goes to needs review";
  if (reason.startsWith("document unreadable")) return "The model could not read the document, so the invoice goes to needs review";
  if (reason.startsWith("unsupported file type")) return "The file type is not supported, so the invoice goes to needs review";
  if (reason.startsWith("model API returned") || reason.startsWith("model returned no text")) return "The model call failed, so the invoice goes to needs review";
  if (reason.startsWith("ANTHROPIC_API_KEY")) return "No model key is configured and the file was not in the saved answers, so the invoice goes to needs review";
  if (reason.includes("no stored file")) return "The invoice has no stored file, so it goes to needs review";
  return "Extraction failed, so the invoice goes to needs review";
}

export type ProcessStep = { id: number; step: string; status: StepStatus; detail: string; durationMs: number; createdAt: string };
const COLS = "id, step, status, detail, duration_ms AS durationMs, created_at AS createdAt";

// Same visibility as the invoice itself (404 when hidden, so ids cannot be probed).
export function invoiceProcessLog(user: User, invoiceId: number): ProcessStep[] {
  const db = getDb();
  const v = visibleSql(user);
  if (!db.prepare(`SELECT 1 FROM invoices i WHERE i.id = ? AND ${v.sql}`).get(invoiceId, ...v.args)) throw new ViewError(404, "Invoice not found");
  return db.prepare(`SELECT ${COLS} FROM process_log WHERE invoice_id = ? ORDER BY id`).all(invoiceId) as ProcessStep[];
}

// Latest steps across all invoices, newest first.
export function recentProcessLog(limit: number) {
  return getDb()
    .prepare(
      `SELECT p.id, p.invoice_id AS invoiceId, i.invoice_number AS invoiceNumber, p.step, p.status, p.detail, p.duration_ms AS durationMs, p.created_at AS createdAt
       FROM process_log p JOIN invoices i ON i.id = p.invoice_id ORDER BY p.id DESC LIMIT ?`
    )
    .all(limit) as (ProcessStep & { invoiceId: number; invoiceNumber: string })[];
}

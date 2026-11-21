import fs from "node:fs";
import path from "node:path";
import { extractInvoice, type ExtractedInvoice, type ExtractResult } from "@/extract/extractInvoice";
import { writeAudit } from "./audit";
import { createChain } from "./approvals";
import { getDb } from "./db";
import { transition } from "./invoiceStatus";
import { checkArithmetic } from "./rules/arithmetic";
import { checkBankChange } from "./rules/bank";
import { suggestCoding } from "./rules/coding";
import { findDuplicates } from "./rules/duplicates";
import type { Finding } from "./rules/types";

// Response types live here, not in contracts.ts (lead-owned).
export type ProcessResult = {
  invoiceId: number;
  status: "needs_review" | "pending_approval";
  flags: Finding[];
  approverId: number | null;
};

// Carries the HTTP status so routes stay thin.
export class PipelineError extends Error {
  constructor(public status: 404 | 409, message: string) {
    super(message);
  }
}

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" };
const error = (code: string, message: string): Finding => ({ code, message, severity: "error" });
const warning = (code: string, message: string): Finding => ({ code, message, severity: "warning" });
// Case, spacing and punctuation are formatting, not a different company.
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Never throws: an unreadable file or a crashing extractor is just another needs_review.
async function extract(file: string | null): Promise<ExtractResult> {
  try {
    if (!file) return { status: "needs_review", reason: "invoice has no stored file" };
    const bytes = fs.readFileSync(file);
    return await extractInvoice(bytes, MIME[path.extname(file).slice(1)] ?? "");
  } catch (e) {
    return { status: "needs_review", reason: e instanceof Error ? e.message : "extraction failed" };
  }
}

// Reads the stored file, extracts, checks, then moves the invoice to needs_review or pending_approval.
// ponytail: only 'received' invoices run; re-running a needs_review one needs a retry flow if we want it.
export async function processInvoice(invoiceId: number, actorId: number | null = null): Promise<ProcessResult> {
  const db = getDb();
  const first = db.prepare("SELECT status, source_file FROM invoices WHERE id = ?").get(invoiceId) as
    | { status: string; source_file: string | null }
    | undefined;
  if (!first) throw new PipelineError(404, "Invoice not found");
  if (first.status !== "received") throw new PipelineError(409, `Invoice is ${first.status}, not received`);

  // The slow model call happens outside the transaction; everything after it is one atomic step.
  const extracted = await extract(first.source_file);

  return db.transaction(() => {
    // Re-check: another request may have processed it while we waited on the model.
    const now = db.prepare("SELECT status FROM invoices WHERE id = ?").get(invoiceId) as { status: string };
    if (now.status !== "received") throw new PipelineError(409, `Invoice is ${now.status}, not received`);

    // Persists flags, audits them, moves the status. Errors send it to a human; warnings ride along.
    const finish = (flags: Finding[], approverId: number | null): ProcessResult => {
      const status = flags.some((f) => f.severity === "error") ? "needs_review" : "pending_approval";
      db.prepare("UPDATE invoices SET flags = ? WHERE id = ?").run(JSON.stringify(flags), invoiceId);
      writeAudit({ actorId, action: "invoice.checks", entity: "invoice", entityId: invoiceId, before: { flags: [] }, after: { flags } });
      transition(invoiceId, status, actorId);
      return { invoiceId, status, flags, approverId: status === "pending_approval" ? approverId : null };
    };

    if (extracted.status !== "ok") {
      writeAudit({ actorId, action: "invoice.extraction_failed", entity: "invoice", entityId: invoiceId, after: { reason: extracted.reason } });
      return finish([error("extraction_failed", extracted.reason)], null);
    }
    const x: ExtractedInvoice = extracted.invoice;

    // Vendor match. The extractor does not return a tax id yet, so name is the only key.
    const vendors = db.prepare("SELECT id, name FROM vendors").all() as { id: number; name: string }[];
    const hits = vendors.filter((v) => normName(v.name) === normName(x.vendorName));
    const vendorId = hits.length === 1 ? hits[0].id : null;
    const flags: Finding[] = [];
    if (hits.length === 0) flags.push(error("vendor_unmatched", `No vendor named "${x.vendorName}"`));
    if (hits.length > 1) flags.push(error("vendor_ambiguous", `${hits.length} vendors match "${x.vendorName}"`));
    const po = x.poNumber
      ? (db.prepare("SELECT id FROM purchase_orders WHERE po_number = ?").get(x.poNumber) as { id: number } | undefined)
      : undefined;
    if (x.poNumber && !po) flags.push(warning("po_not_found", `PO ${x.poNumber} is not on file`));

    // Save what was read (lines replaced so a rerun never doubles them).
    db.prepare(
      "UPDATE invoices SET vendor_id=?, invoice_number=?, invoice_date=?, total_cents=?, currency=?, po_id=?, extraction_json=?, extracted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
    ).run(vendorId, x.invoiceNumber, x.invoiceDate, x.totalCents, x.currency, po?.id ?? null, JSON.stringify(x), invoiceId);
    db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(invoiceId);
    const addLine = db.prepare(
      "INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price_cents, amount_cents, currency) VALUES (?,?,?,?,?,?)"
    );
    // quantity column is INTEGER; fractional quantities are kept as-is in extraction_json.
    for (const l of x.lines) addLine.run(invoiceId, l.description, Math.round(Number(l.quantity)), l.unitPriceCents, l.amountCents, x.currency);
    writeAudit({
      actorId, action: "invoice.extracted", entity: "invoice", entityId: invoiceId,
      after: { vendorId, invoiceNumber: x.invoiceNumber, invoiceDate: x.invoiceDate, totalCents: x.totalCents, currency: x.currency, poId: po?.id ?? null, lines: x.lines.length },
    });

    // Checks. Each is a plain function; this code only gathers their inputs from the DB.
    flags.push(...checkArithmetic(x.lines.map((l) => ({ totalCents: l.amountCents })), x.taxes, x.totalCents));
    if (vendorId !== null) {
      const others = db
        .prepare("SELECT id, invoice_number, total_cents, invoice_date FROM invoices WHERE vendor_id = ? AND id != ? AND invoice_number != ''")
        .all(vendorId, invoiceId) as { id: number; invoice_number: string; total_cents: number; invoice_date: string }[];
      flags.push(
        ...findDuplicates(
          { id: String(invoiceId), vendorId: String(vendorId), number: x.invoiceNumber, totalCents: x.totalCents, date: x.invoiceDate },
          others.map((o) => ({ id: String(o.id), vendorId: String(vendorId), number: o.invoice_number, totalCents: o.total_cents, date: o.invoice_date }))
        )
      );
      if (x.bankDetails) {
        // The dataset keeps only the last 4 digits of each account, so that is what gets compared.
        // The account before the first change is the starting point; each change row is a later record.
        const changes = db
          .prepare("SELECT old_account_last4, new_account_last4, changed_at FROM vendor_bank_changes WHERE vendor_id = ? ORDER BY changed_at")
          .all(vendorId) as { old_account_last4: string | null; new_account_last4: string | null; changed_at: string }[];
        const history = changes.map((c) => ({ accountNumber: c.new_account_last4 ?? "", since: c.changed_at.slice(0, 10) }));
        if (changes[0]?.old_account_last4) history.unshift({ accountNumber: changes[0].old_account_last4, since: "0000-01-01" });
        flags.push(
          ...checkBankChange({ accountNumber: x.bankDetails.replace(/\D/g, "").slice(-4) }, history, new Date().toISOString().slice(0, 10))
        );
      }

      // Coding is a suggestion from this vendor's past lines; it is applied to the lines and audited.
      const past = db
        .prepare(
          `SELECT g.code AS account, t.code AS tax FROM invoice_lines l
           JOIN invoices i ON i.id = l.invoice_id JOIN gl_accounts g ON g.id = l.gl_account_id JOIN tax_codes t ON t.id = l.tax_code_id
           WHERE i.vendor_id = ? AND i.id != ?`
        )
        .all(vendorId, invoiceId) as { account: string; tax: string }[];
      const coding = suggestCoding(String(vendorId), past.map((p) => ({ vendorId: String(vendorId), accountCode: p.account, taxCode: p.tax })));
      if (coding.status === "suggested") {
        db.prepare(
          "UPDATE invoice_lines SET gl_account_id = (SELECT id FROM gl_accounts WHERE code = ?), tax_code_id = (SELECT id FROM tax_codes WHERE code = ?) WHERE invoice_id = ?"
        ).run(coding.accountCode, coding.taxCode, invoiceId);
      }
      writeAudit({ actorId, action: "invoice.coding_suggestion", entity: "invoice", entityId: invoiceId, after: coding });
    }

    // Routing only matters if nothing needs a human first.
    if (flags.some((f) => f.severity === "error")) return finish(flags, null);
    // The chain is stored as pending steps; if nobody can fill a step, a human looks at it.
    try {
      const steps = createChain(invoiceId, actorId);
      return finish(flags, Number(steps[0].userId));
    } catch (e) {
      return finish([...flags, error("routing_failed", e instanceof Error ? e.message : "approval routing failed")], null);
    }
  })();
}

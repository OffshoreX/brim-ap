import fs from "node:fs";
import path from "node:path";
import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { inspectUpload, storeUpload } from "./files";

export type EmailClass = "invoice" | "credit_note" | "statement" | "payment_inquiry" | "marketing" | "invoice_missing_attachment";
export type Email = { email_id: string; from_address: string; subject: string; received_at?: string; body: string; attachments: string[] };
export type Classified = { class: EmailClass; attachments: string[] };

// Lowercase and strip accents so "Relevé" and "crédit" match plain-ASCII rules.
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Plain keyword rules, English and French. No LLM: the same email always gets the same class.
export function classifyEmail(email: Email): Classified {
  const attachments = email.attachments ?? [];
  const subject = norm(email.subject ?? "");
  const text = `${subject} ${norm(email.body ?? "")}`;
  const has = (re: RegExp) => re.test(text);
  if (attachments.length > 0) {
    if (has(/\bstatement\b|\breleve de compte/) && !has(/\binvoice\b|\bfacture\b/)) return { class: "statement", attachments };
    // "CN-" is how the dataset marks credit notes in invoice numbers.
    if (has(/\bcredit\b|\bcn-|note de credit/))
      return { class: "credit_note", attachments };
    return { class: "invoice", attachments };
  }
  // No attachment: the words decide. Inquiry first because it also mentions "invoice".
  if (has(/where is|not seen payment|have not received|payment status|ou est le paiement|paiement/)) return { class: "payment_inquiry", attachments };
  if (has(/\bstatement\b|\breleve de compte/)) return { class: "statement", attachments };
  if (has(/\bsale\b|% off|promo|\bsolde\b|rabais|unsubscribe/)) return { class: "marketing", attachments };
  if (has(/\binvoice\b|\bfacture\b/)) return { class: "invoice_missing_attachment", attachments };
  // Unknown mail never makes an invoice; it lands in the list for a human to read.
  return { class: "marketing", attachments };
}

export type ImportResult = { emailId: string; class: EmailClass; invoiceIds: number[]; flags: string[]; skipped?: "already_imported" };

const inboxDir = () => process.env.INBOX_DIR || path.join(process.cwd(), "brim_ap_dataset");

export function readEmails(): Email[] {
  return JSON.parse(fs.readFileSync(path.join(inboxDir(), "inbox", "emails.json"), "utf8"));
}

// Idempotent: an email already in inbox_mail is skipped, so re-running never doubles invoices.
export function importInbox(user: User, emails: Email[] = readEmails()): ImportResult[] {
  const db = getDb();
  return db.transaction(() =>
    emails.map((email): ImportResult => {
      if (db.prepare("SELECT 1 FROM inbox_mail WHERE email_id = ?").get(email.email_id))
        return { emailId: email.email_id, class: "invoice", invoiceIds: [], flags: [], skipped: "already_imported" };
      const c = classifyEmail(email);
      const flags: string[] = [];
      const invoiceIds: number[] = [];
      if (c.class === "invoice_missing_attachment") flags.push("missing_attachment");
      db.prepare("INSERT INTO inbox_mail (email_id, from_address, subject, received_at, class, attachments, flags) VALUES (?,?,?,?,?,?,?)")
        .run(email.email_id, email.from_address, email.subject, email.received_at ?? null, c.class, JSON.stringify(c.attachments), "[]");
      if (c.class === "invoice" || c.class === "credit_note") {
        for (const name of c.attachments) {
          // Bad input (file missing, wrong type) flags the email and creates nothing for that file.
          try {
            const file = path.join(inboxDir(), "incoming_invoices", path.basename(name));
            const bytes = fs.readFileSync(file);
            const { sha, ext } = inspectUpload(bytes);
            const source = storeUpload(bytes, `${sha}.${ext}`);
            const invoiceFlags = ["from_email", ...(c.class === "credit_note" ? ["credit_note"] : [])];
            const id = Number(
              db.prepare(
                "INSERT INTO invoices (status, invoice_number, invoice_date, total_cents, currency, requester_id, source_file, flags) VALUES ('received','','',0,'CAD',?,?,?)"
              ).run(user.id, source, JSON.stringify(invoiceFlags)).lastInsertRowid
            );
            db.prepare("INSERT INTO invoice_email (invoice_id, email_id, from_address) VALUES (?,?,?)").run(id, email.email_id, email.from_address);
            writeAudit({ actorId: user.id, action: "invoice.email_import", entity: "invoice", entityId: id, before: null, after: { status: "received", emailId: email.email_id, from: email.from_address, attachment: name } });
            invoiceIds.push(id);
          } catch {
            flags.push(`unreadable_attachment:${name}`);
          }
        }
        // Two invoices in one email: each is flagged as a possible duplicate of the other.
        if (invoiceIds.length > 1) {
          flags.push("possible_duplicate_attachments");
          for (const id of invoiceIds) {
            const others = invoiceIds.filter((o) => o !== id);
            const row = db.prepare("SELECT flags FROM invoices WHERE id = ?").get(id) as { flags: string };
            const after = JSON.stringify([...JSON.parse(row.flags), "possible_duplicate", ...others.map((o) => `possible_duplicate_of:${o}`)]);
            db.prepare("UPDATE invoices SET flags = ? WHERE id = ?").run(after, id);
            writeAudit({ actorId: user.id, action: "invoice.flag_duplicate", entity: "invoice", entityId: id, before: JSON.parse(row.flags), after: JSON.parse(after) });
          }
        }
      }
      db.prepare("UPDATE inbox_mail SET flags = ? WHERE email_id = ?").run(JSON.stringify(flags), email.email_id);
      writeAudit({ actorId: user.id, action: "inbox.import", entity: "inbox_mail", entityId: email.email_id, before: null, after: { class: c.class, invoiceIds, flags } });
      return { emailId: email.email_id, class: c.class, invoiceIds, flags };
    })
  )();
}

// Everything that did not become an invoice, plus invoice emails whose attachments failed.
export function listOtherMail() {
  const rows = getDb()
    .prepare(
      `SELECT email_id, from_address, subject, received_at, class, attachments, flags FROM inbox_mail
       WHERE class NOT IN ('invoice','credit_note') OR flags != '[]' ORDER BY email_id`
    )
    .all() as { email_id: string; from_address: string; subject: string; received_at: string | null; class: string; attachments: string; flags: string }[];
  return rows.map((r) => ({ emailId: r.email_id, from: r.from_address, subject: r.subject, receivedAt: r.received_at, class: r.class, attachments: JSON.parse(r.attachments), flags: JSON.parse(r.flags) }));
}

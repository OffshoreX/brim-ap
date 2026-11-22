import fs from "node:fs";
import path from "node:path";
import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { requestBankChange, VendorError } from "./vendors";
import { getDb } from "./db";
import { inspectUpload, storeUpload } from "./files";
import { DEFAULT_PAGE, type Page } from "./paging";
import { cleanText, hasMixedScripts, skeleton, stripBidi } from "./rules/unicode";

export type EmailClass = "invoice" | "credit_note" | "statement" | "payment_inquiry" | "marketing" | "invoice_missing_attachment" | "bank_change" | "suspicious";
export type Email = { email_id: string; from_address: string; subject: string; received_at?: string; body: string; attachments: string[] };
// reason is set for "suspicious" (why); bank is set for "bank_change" when the details could be read.
export type Classified = { class: EmailClass; attachments: string[]; reason?: string; bank?: { institution: string; transit: string; account: string } };

// Lowercase and strip accents so "Relevé" and "crédit" match plain-ASCII rules.
// Input is capped first: the rules below run on untrusted mail, and a 50,000-character body must not make them slow.
export const MAX_MAIL_TEXT = 20_000;
const norm = (s: string) => s.slice(0, MAX_MAIL_TEXT).normalize("NFKC").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Mail that tries to instruct the system. Each rule has a short reason the clerk reads in the inbox list.
const SUSPICIOUS: [RegExp, string][] = [
  [/\burgent|\bpay(ment)?\b[^.]{0,20}\b(now|immediately|today|asap)\b|paye[zr]\b[^.]{0,20}\b(maintenant|immediatement)/, "urgent: asks for payment now"],
  [/\b(skip|bypass|waive|ignore|override|without|no need for)\b[^.]{0,30}\b(approval|approver|review|verification|callback|polic)/, "asks to skip approval or verification"],
  [/\b(send|wire|transfer|pay|remit)\w*\b[^.]{0,40}\b(to|into) (the |our )?(new|different|another) (bank )?account/, "tells us to pay a new account"],
];
// A notice that the vendor's bank details changed. Becomes a request only from a known sender (see below).
const BANK_CHANGE = /\b(change|update|replac|switch|new)\w*\b[^.]{0,40}\b(bank|banking|remittance) (details|account|information)|\bnew (bank )?account\b|coordonnees bancaires/;

// Institution, transit, account as labelled text or as 3-5-7+ digits. Anything else is not guessed.
export function parseBankText(text: string) {
  const t = norm(text); // norm caps the length
  const labelled = [t.match(/institution\D{0,15}(\d{3})\b/), t.match(/transit\D{0,15}(\d{5})\b/), t.match(/account\D{0,20}(\d{7,12})\b/)];
  if (labelled.every(Boolean)) return { institution: labelled[0]![1], transit: labelled[1]![1], account: labelled[2]![1] };
  const m = t.match(/\b(\d{3})[\s-](\d{5})[\s-](\d{7,12})\b/);
  return m ? { institution: m[1], transit: m[2], account: m[3] } : null;
}

// Plain keyword rules, English and French. No LLM: the same email always gets the same class.
// senderVendorIds = vendors whose ap_contact_email equals the sender (empty if the sender is unknown).
export function classifyEmail(email: Email, senderVendorIds: number[] = []): Classified {
  const attachments = email.attachments ?? [];
  const subject = norm(email.subject ?? "");
  const text = `${subject} ${norm(email.body ?? "")}`;
  const has = (re: RegExp) => re.test(text);
  // Instructions come first: an invoice that also says "pay now, skip approval" is not processed.
  const hit = SUSPICIOUS.find(([re]) => has(re));
  if (hit) return { class: "suspicious", attachments, reason: hit[1] };
  if (has(BANK_CHANGE)) {
    // Only one known vendor sender may ask. Unknown or shared sender addresses could be anyone.
    if (senderVendorIds.length !== 1) return { class: "suspicious", attachments, reason: "bank change from an unknown sender" };
    return { class: "bank_change", attachments, bank: parseBankText(email.body ?? "") ?? undefined };
  }
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

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

// Warning text when the sender's domain mixes scripts, or reads like a vendor's domain without being it ("pacifiс-fuel.com" with a Cyrillic с).
export function senderLookalike(from: string, knownDomains: string[]): string | null {
  const domain = domainOf(from);
  if (!from.includes("@")) return null;
  if (hasMixedScripts(domain)) return `sender_lookalike: the domain "${domain}" mixes alphabets`;
  const twin = knownDomains.find((d) => d !== domain && skeleton(d) === skeleton(domain));
  return twin ? `sender_lookalike: the domain "${domain}" looks like the vendor domain "${twin}"` : null;
}

export type ImportResult = { emailId: string; class: EmailClass; invoiceIds: number[]; flags: string[]; skipped?: "already_imported" };

const inboxDir = () => process.env.INBOX_DIR || path.join(process.cwd(), "brim_ap_dataset");

export function readEmails(): Email[] {
  return JSON.parse(fs.readFileSync(path.join(inboxDir(), "inbox", "emails.json"), "utf8"));
}

// Idempotent: an email already in inbox_mail is skipped, so re-running never doubles invoices.
export function importInbox(user: User, emails: Email[] = readEmails()): ImportResult[] {
  const db = getDb();
  const contactDomains = (db.prepare("SELECT ap_contact_email AS e FROM vendors WHERE ap_contact_email LIKE '%@%'").all() as { e: string }[]).map((r) => domainOf(r.e));
  return db.transaction(() =>
    emails.map((raw): ImportResult => {
      // Sender is compared in NFKC form; text shown in the UI and stored in the audit log has bidi controls removed.
      const email: Email = { ...raw, from_address: cleanText(raw.from_address ?? "").trim(), subject: stripBidi(raw.subject ?? ""), body: raw.body ?? "" };
      if (db.prepare("SELECT 1 FROM inbox_mail WHERE email_id = ?").get(email.email_id))
        return { emailId: email.email_id, class: "invoice", invoiceIds: [], flags: [], skipped: "already_imported" };
      const senders = db.prepare("SELECT id FROM vendors WHERE lower(ap_contact_email) = lower(?)").all(email.from_address ?? "") as { id: number }[];
      const c = classifyEmail(email, senders.map((v) => v.id));
      const flags: string[] = [];
      const lookalike = senderLookalike(email.from_address, contactDomains);
      if (lookalike) flags.push(lookalike);
      const invoiceIds: number[] = [];
      if (c.class === "invoice_missing_attachment") flags.push("missing_attachment");
      if (c.class === "suspicious") flags.push(`suspicious: ${c.reason}`); // nothing else happens to this mail
      let bankChangeId: number | undefined;
      if (c.class === "bank_change") {
        // Same workflow as a clerk typing it in: pending, verified_by_callback = 0, a different user must verify. The email text never edits the vendor.
        if (!c.bank) flags.push("bank_details_unreadable");
        else
          try {
            bankChangeId = requestBankChange(user, senders[0].id, { ...c.bank, channel: `email:${email.email_id}` }).id;
            flags.push(`bank_change_request:${bankChangeId}`);
          } catch (e) {
            if (!(e instanceof VendorError)) throw e;
            flags.push(`bank_change_not_created: ${e.message}`);
          }
      }
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
      writeAudit({ actorId: user.id, action: "inbox.import", entity: "inbox_mail", entityId: email.email_id, before: null, after: { class: c.class, invoiceIds, flags, ...(bankChangeId ? { bankChangeId } : {}) } });
      return { emailId: email.email_id, class: c.class, invoiceIds, flags };
    })
  )();
}

// Everything that did not become an invoice, plus invoice emails whose attachments failed.
const OTHER_WHERE = "class NOT IN ('invoice','credit_note') OR flags != '[]'";
export const countOtherMail = () =>
  (getDb().prepare(`SELECT COUNT(*) n FROM inbox_mail WHERE ${OTHER_WHERE}`).get() as { n: number }).n;

export function listOtherMail(page: Page = DEFAULT_PAGE) {
  const rows = getDb()
    .prepare(
      `SELECT email_id, from_address, subject, received_at, class, attachments, flags FROM inbox_mail
       WHERE ${OTHER_WHERE} ORDER BY email_id LIMIT ? OFFSET ?`
    )
    .all(page.limit, page.offset) as { email_id: string; from_address: string; subject: string; received_at: string | null; class: string; attachments: string; flags: string }[];
  return rows.map((r) => {
    const flags: string[] = JSON.parse(r.flags);
    // Suspicious mail says why; everything else has no reason.
    const reason = flags.find((f) => f.startsWith("suspicious: "))?.slice(12) ?? null;
    return { emailId: r.email_id, from: r.from_address, subject: r.subject, receivedAt: r.received_at, class: r.class, reason, attachments: JSON.parse(r.attachments), flags };
  });
}

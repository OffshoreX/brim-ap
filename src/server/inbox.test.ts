import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { classifyEmail, importInbox, readEmails, type Email } from "./inbox";
import { POST as importMail } from "@/app/api/inbox/import/route";
import { GET as other } from "@/app/api/inbox/other/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const emails = readEmails();
const byId = (id: string) => emails.find((e) => e.email_id === id) as Email;
const cookie = (u: number) => ({ cookie: `session=${signSession(u)}` });
const run = (u: number | null) => importMail(new Request("http://x", { method: "POST", headers: u ? cookie(u) : {} }));
const count = (sql: string) => (getDb().prepare(sql).get() as { n: number }).n;
const isInvoiceClass = (e: Email) => ["invoice", "credit_note"].includes(classifyEmail(e).class);

beforeEach(() => {
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-"));
  resetDbForTests();
  getDb().prepare("INSERT INTO users (id,name,role) VALUES (1,'Emp','employee'),(3,'Clerk','ap_clerk'),(5,'Fin','finance_manager'),(6,'Admin','controller_admin'),(7,'Aud','auditor')").run();
});

test("each class is detected on a real email from the file", () => {
  expect(classifyEmail(byId("EM-002")).class).toBe("invoice"); // English
  expect(classifyEmail(byId("EM-001")).class).toBe("invoice"); // "Facture", French
  expect(classifyEmail(byId("EM-025")).class).toBe("credit_note");
  expect(classifyEmail(byId("EM-042")).class).toBe("credit_note"); // French subject
  expect(classifyEmail(byId("EM-056")).class).toBe("statement");
  expect(classifyEmail(byId("EM-057")).class).toBe("payment_inquiry");
  expect(classifyEmail(byId("EM-059")).class).toBe("marketing");
  expect(classifyEmail(byId("EM-058")).class).toBe("invoice_missing_attachment");
  expect(classifyEmail(byId("EM-029")).attachments).toHaveLength(2);
});

test("only mail with attachments can become an invoice class", () => {
  for (const e of emails) expect(isInvoiceClass(e)).toBe(e.attachments.length > 0);
});

test("only ap_clerk and controller_admin import; 401 without a cookie", async () => {
  expect((await run(null)).status).toBe(401);
  for (const u of [1, 5, 7]) expect((await run(u)).status).toBe(403);
  expect((await run(3)).status).toBe(200);
  expect((await run(6)).status).toBe(200);
});

test("import: one invoice per attachment, none for other mail, two-attachment email flagged", async () => {
  const res = await (await run(3)).json();
  const total = emails.filter(isInvoiceClass).reduce((n, e) => n + e.attachments.length, 0);
  expect(count("SELECT COUNT(*) n FROM invoices")).toBe(total);
  expect(count("SELECT COUNT(*) n FROM invoices WHERE status != 'received'")).toBe(0);
  const of = (id: string) => res.find((r: { emailId: string }) => r.emailId === id);
  for (const id of ["EM-056", "EM-059", "EM-057", "EM-058"]) expect(of(id).invoiceIds).toEqual([]);
  const two = of("EM-029");
  expect(two.invoiceIds).toHaveLength(2);
  two.invoiceIds.forEach((id: number, i: number) => {
    const row = getDb().prepare("SELECT flags FROM invoices WHERE id = ?").get(id) as { flags: string };
    expect(JSON.parse(row.flags)).toContain("possible_duplicate");
    expect(JSON.parse(row.flags)).toContain(`possible_duplicate_of:${two.invoiceIds[1 - i]}`);
  });
  const sender = getDb().prepare("SELECT from_address FROM invoice_email WHERE invoice_id = ?").get(two.invoiceIds[0]) as { from_address: string };
  expect(sender.from_address).toBe(byId("EM-029").from_address);
});

test("non_invoice_mail lists the other classes; missing attachment is flagged; audit rows written", async () => {
  await run(3);
  const list = await (await other(new Request("http://x", { headers: cookie(7) }))).json();
  const ids = list.map((m: { emailId: string }) => m.emailId);
  expect(ids).toEqual(expect.arrayContaining(["EM-056", "EM-057", "EM-058", "EM-059"]));
  expect(ids).not.toContain("EM-002");
  expect(list.find((m: { emailId: string }) => m.emailId === "EM-058").flags).toContain("missing_attachment");
  expect((await other(new Request("http://x", { headers: cookie(1) }))).status).toBe(403);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'inbox.import'")).toBe(emails.length);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'invoice.email_import'")).toBe(count("SELECT COUNT(*) n FROM invoices"));
});

test("running the import twice does not double invoices", async () => {
  await run(3);
  const n = count("SELECT COUNT(*) n FROM invoices");
  await run(3);
  expect(count("SELECT COUNT(*) n FROM invoices")).toBe(n);
});

test("an unreadable attachment is flagged, creates no invoice, and does not stop the batch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bad-"));
  fs.mkdirSync(path.join(dir, "incoming_invoices"));
  fs.writeFileSync(path.join(dir, "incoming_invoices", "junk.pdf"), "not a pdf");
  process.env.INBOX_DIR = dir;
  try {
    const mk = (id: string, att: string[]): Email => ({ email_id: id, from_address: "a@x.example", subject: "Invoice 1", body: "attached", attachments: att });
    const user = getDb().prepare("SELECT * FROM users WHERE id = 3").get() as never;
    const res = importInbox(user, [mk("T1", ["junk.pdf"]), mk("T2", ["missing.pdf"])]);
    expect(res.map((r) => r.invoiceIds)).toEqual([[], []]);
    expect(res[0].flags[0]).toContain("unreadable_attachment");
    expect(count("SELECT COUNT(*) n FROM invoices")).toBe(0);
  } finally {
    delete process.env.INBOX_DIR;
  }
});

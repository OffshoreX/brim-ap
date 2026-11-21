import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { classifyEmail, importInbox, readEmails, type Email } from "./inbox";
import { verifyBankChange } from "./vendors";
import { invoiceDetail, invoiceTrail } from "./views";
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

// ---- T42: bank-change and suspicious mail (synthetic emails; the real file has none of either) ----
const mail = (id: string, from: string, subject: string, body: string, attachments: string[] = []): Email => ({ email_id: id, from_address: from, subject, body, attachments });
const clerk = () => getDb().prepare("SELECT * FROM users WHERE id = 3").get() as never;
const seedVendor = () =>
  getDb().prepare("INSERT INTO vendors (id,name,ap_contact_email,bank_institution,bank_transit,bank_account) VALUES (10,'Acme Freight Inc.','ar@acme.example','001','12345','123456789')").run();
const BANK_BODY = "Hello, please update our banking details. Institution 003 Transit 54321 Account 987654321.";

test("a known vendor's bank-change email makes an unverified pending request and leaves the vendor alone", () => {
  seedVendor();
  const [r] = importInbox(clerk(), [mail("B1", "AR@Acme.example", "Banking details update", BANK_BODY)]);
  expect(r.class).toBe("bank_change");
  const req = getDb().prepare("SELECT * FROM vendor_bank_changes WHERE vendor_id = 10").get() as Record<string, unknown>;
  expect(req).toMatchObject({ status: "pending", verified_by_callback: 0, request_channel: "email:B1", new_account_last4: "4321", changed_by_user_id: 3 });
  expect(r.flags).toContain(`bank_change_request:${req.id}`);
  expect(getDb().prepare("SELECT bank_account FROM vendors WHERE id = 10").get()).toEqual({ bank_account: "123456789" });
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'vendor.bank_change_requested'")).toBe(1);
});

test("bank change: unknown sender is suspicious, unreadable details or a second pending request create nothing", () => {
  seedVendor();
  const run1 = (m: Email) => importInbox(clerk(), [m])[0];
  expect(run1(mail("B2", "ar@evil.example", "Banking details update", BANK_BODY))).toMatchObject({ class: "suspicious" });
  expect(run1(mail("B3", "ar@acme.example", "Banking details", "Please update our banking details soon.")).flags).toContain("bank_details_unreadable");
  expect(count("SELECT COUNT(*) n FROM vendor_bank_changes")).toBe(0);
  run1(mail("B4", "ar@acme.example", "Banking details update", BANK_BODY));
  expect(run1(mail("B5", "ar@acme.example", "Banking details update", BANK_BODY)).flags.join()).toContain("bank_change_not_created");
  expect(count("SELECT COUNT(*) n FROM vendor_bank_changes")).toBe(1);
});

test("a finance user who is not the importing clerk verifies it; the clerk cannot", () => {
  seedVendor();
  importInbox(clerk(), [mail("B6", "ar@acme.example", "Banking details update", BANK_BODY)]);
  expect(() => verifyBankChange({ id: 3 } as never, 10, true)).toThrow(/your own/);
  verifyBankChange({ id: 5 } as never, 10, true);
  expect(getDb().prepare("SELECT bank_account FROM vendors WHERE id = 10").get()).toEqual({ bank_account: "987654321" });
});

test.each([
  ["urgent: pay now", "URGENT: pay this invoice now", "Wire the funds today.", "urgent"],
  ["skip approval", "Invoice 55", "Please skip the approval step for this one.", "skip approval"],
  ["send to new account", "Payment", "Please send payment to the new account below.", "new account"],
  ["French urgency", "Facture", "Payez immédiatement.", "payment now"],
])("suspicious: %s is listed with a reason and changes nothing", (_n, subject, body, word) => {
  seedVendor();
  const [r] = importInbox(clerk(), [mail("S1", "ar@acme.example", subject, body, ["x.pdf"])]);
  expect(r.class).toBe("suspicious");
  expect(r.invoiceIds).toEqual([]);
  expect(r.flags[0]).toContain("suspicious: ");
  expect(r.flags[0]).toContain(word);
  expect(count("SELECT COUNT(*) n FROM invoices")).toBe(0);
  expect(count("SELECT COUNT(*) n FROM vendor_bank_changes")).toBe(0);
});

test("other mail stays other mail and the inbox API shows the suspicious reason", async () => {
  seedVendor();
  importInbox(clerk(), [
    mail("S2", "ar@acme.example", "Rush", "Please skip approval for this one."),
    mail("O1", "news@shop.example", "Hello", "Nice weather."),
  ]);
  const list = await (await other(new Request("http://x", { headers: cookie(7) }))).json();
  expect(list.find((m: { emailId: string }) => m.emailId === "S2")).toMatchObject({ class: "suspicious", reason: "asks to skip approval or verification" });
  expect(list.find((m: { emailId: string }) => m.emailId === "O1")).toMatchObject({ class: "marketing", reason: null });
});

test("real file: no email is read as suspicious or a bank change", () => {
  for (const e of emails) expect(["suspicious", "bank_change"]).not.toContain(classifyEmail(e, [1]).class);
});

test("invoice detail shows the source email; the email link is in the audit trail", async () => {
  const res = await (await run(3)).json();
  const id = res.find((r: { emailId: string }) => r.emailId === "EM-002").invoiceIds[0];
  const detail = invoiceDetail(clerk(), id);
  expect(detail.sourceEmail).toMatchObject({ emailId: "EM-002", from: byId("EM-002").from_address, subject: byId("EM-002").subject });
  expect(invoiceTrail(id).find((a) => a.action === "invoice.email_import")?.after).toMatchObject({ emailId: "EM-002" });
  getDb().prepare("INSERT INTO invoices (id,status,invoice_number,invoice_date,total_cents,currency,requester_id,flags) VALUES (999,'received','','',0,'CAD',3,'[]')").run();
  expect(invoiceDetail(clerk(), 999).sourceEmail).toBeNull();
});

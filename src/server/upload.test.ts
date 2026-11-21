import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as upload } from "@/app/api/invoices/upload/route";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";

// No network: the extractor is replaced for every test.
vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";
const extractMock = vi.mocked(extractInvoice);

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const good: ExtractedInvoice = {
  vendorName: "Acme Freight Inc.", invoiceNumber: "INV-100", invoiceDate: "2026-11-01", dueDate: null, currency: "CAD",
  lines: [{ description: "Freight", quantity: "2", unitPriceCents: 5000, amountCents: 10000 }],
  taxes: [{ label: "HST 13%", code: "HST", amountCents: 1300 }], totalCents: 11300, poNumber: null, bankDetails: "001-12345-123456789", language: "en",
};
const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`);
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  process.env.UPLOAD_DIR = dir;
  resetDbForTests();
  extractMock.mockReset();
  getDb().exec(`
    INSERT INTO users (id,name,role,approval_limit_cents,province,department_id,manager_id) VALUES
      (1,'Emp','employee',0,'ON',NULL,NULL),(3,'Appr','approver',100000000,'ON',NULL,NULL),(4,'Aud','auditor',0,'ON',NULL,NULL),(5,'Fin','finance_manager',0,'ON',NULL,NULL);
    INSERT INTO departments (id,name,manager_user_id) VALUES (1,'Ops',3);
    UPDATE users SET department_id = 1, manager_id = 3 WHERE id = 1;
    INSERT INTO approval_policies (ext_id,rule_type,condition,required) VALUES
      ('P02','approval','Invoice total over $10,000 CAD','dept_manager > finance_manager'),
      ('P03','approval','Invoice total over $50,000 CAD','dept_manager > finance_manager > controller_admin'),
      ('P04','approval','Invoice total over $250,000 CAD','dept_manager > finance_manager > controller_admin > cfo');
    INSERT INTO gl_accounts (id,code,name) VALUES (5010,'5010','Freight');
    INSERT INTO vendors (id,name,bank_institution,bank_transit,bank_account,default_gl_account) VALUES (1,'ACME Freight Inc','001','12345','123456789','5010');
    INSERT INTO vendor_bank_changes (vendor_id,changed_at,old_account_last4,new_account_last4,request_channel,verified_by_callback) VALUES (1,'2025-01-01','9999','6789','phone_callback_verified',1);
    INSERT INTO tax_codes (code,province,rate_bps,applies_to) VALUES ('HST13','ON',1300,'all');
    -- an earlier invoice gives the vendor a coding history, so the tax-line-type warning stays out of the results
    INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,subtotal_cents,total_cents,currency,total_cad_cents,requester_id)
      VALUES (100,'paid',1,'OLD-1','2026-01-10',5000,5650,'CAD',5650,1);
    INSERT INTO invoice_lines (invoice_id,line_no,line_type,description,quantity,unit_price_cents,amount_cents,currency,gst_hst_code) VALUES (100,1,'services','Freight',1,5000,5000,'CAD','HST13');
  `);
});

const post = (u: number | null, ...files: { name?: string; bytes: Buffer }[]) => {
  const form = new FormData();
  files.forEach((f, i) => form.append("file", new Blob([new Uint8Array(f.bytes)]), f.name ?? `f${i}`));
  return upload(new Request("http://x", { method: "POST", body: form, headers: u ? { cookie: `session=${signSession(u)}` } : {} }));
};
const count = (sql: string) => (getDb().prepare(sql).get() as { n: number }).n;

test("no cookie gets 401, approver, finance_manager and auditor get 403", async () => {
  expect((await post(null, { bytes: pdf("a") })).status).toBe(401);
  for (const u of [3, 4, 5]) expect((await post(u, { bytes: pdf("a") })).status).toBe(403);
});

test("a request with no files gets 400", async () => {
  expect((await post(1)).status).toBe(400);
});

test("five files: good, bad type, same bytes, extraction failure, near-duplicate number each get their own result", async () => {
  // The mock answers by file content, so every file has a known outcome whatever order they run in.
  extractMock.mockImplementation(async (bytes) => {
    const text = bytes.toString();
    if (text.includes("broken")) return { status: "needs_review", reason: "model output was not valid JSON" };
    if (text.includes("near")) return { status: "ok", invoice: { ...good, invoiceNumber: "INV-101" }, cached: false };
    return { status: "ok", invoice: good, cached: false };
  });
  const res = await post(1,
    { name: "good.pdf", bytes: pdf("good") },
    { name: "notes.txt", bytes: Buffer.from("just some text") },
    { name: "copy.pdf", bytes: pdf("good") },
    { name: "scan.pdf", bytes: pdf("broken") },
    { name: "near.pdf", bytes: pdf("near") }
  );
  expect(res.status).toBe(200);
  const { results } = await res.json();
  const summary = results.map((r: { file: string; invoiceId: number | null; status: string; error: string | null; flags: { code: string }[] }) =>
    [r.file, r.invoiceId, r.status, r.error, r.flags.map((f) => f.code)]);
  expect(summary).toEqual([
    ["good.pdf", 101, "pending_approval", null, []],
    ["notes.txt", null, "error", "Only PDF, PNG, JPG or WebP files are accepted", []],
    ["copy.pdf", 101, "pending_approval", null, []], // same bytes: the first file's invoice, not a second row
    ["scan.pdf", 102, "needs_review", null, ["extraction_failed"]],
    ["near.pdf", 103, "pending_approval", null, ["DUPLICATE_NEAR"]],
  ]);
  expect(results[3].flags[0].message).toBe("model output was not valid JSON");
  expect(count("SELECT COUNT(*) n FROM invoices WHERE id > 100")).toBe(3);
  expect(extractMock).toHaveBeenCalledTimes(3); // the copy is never read by the model
});

test("the same bytes uploaded again return the existing invoice, one re-uploaded audit row, no second read", async () => {
  extractMock.mockResolvedValue({ status: "ok", invoice: good, cached: false });
  const first = (await (await post(1, { bytes: pdf("a") })).json()).results[0];
  const again = (await (await post(1, { bytes: pdf("a") })).json()).results[0];
  expect(again).toEqual({ ...first, file: "f0" });
  expect(count("SELECT COUNT(*) n FROM invoices WHERE id > 100")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'invoice.upload'")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'invoice.reuploaded'")).toBe(1);
  expect(fs.readdirSync(dir)).toHaveLength(1);
  expect(extractMock).toHaveBeenCalledTimes(1);
});

test("the same bytes twice in one batch make one invoice", async () => {
  extractMock.mockResolvedValue({ status: "ok", invoice: good, cached: false });
  const { results } = await (await post(1, { bytes: pdf("a") }, { bytes: pdf("a") })).json();
  expect(results.map((r: { invoiceId: number }) => r.invoiceId)).toEqual([101, 101]);
  expect(count("SELECT COUNT(*) n FROM invoices WHERE id > 100")).toBe(1);
});

test("empty, oversized and unsupported files are errors with HTTP 200; png, jpg and webp are accepted", async () => {
  extractMock.mockResolvedValue({ status: "needs_review", reason: "unreadable" });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("x")]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("x")]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPx")]);
  const huge = Buffer.concat([Buffer.from("%PDF"), Buffer.alloc(15 * 1024 * 1024)]);
  const res = await post(1, { bytes: Buffer.alloc(0) }, { bytes: huge }, { bytes: Buffer.from("GIF89a") }, { bytes: png }, { bytes: jpg }, { bytes: webp });
  expect(res.status).toBe(200);
  const { results } = await res.json();
  expect(results.map((r: { error: string | null }) => r.error)).toEqual(["File is empty", "File is larger than 15 MB", "Only PDF, PNG, JPG or WebP files are accepted", null, null, null]);
  expect(results.slice(3).map((r: { status: string }) => r.status)).toEqual(["needs_review", "needs_review", "needs_review"]);
  expect(extractMock.mock.calls.map((c) => c[1]).sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  expect(fs.readdirSync(dir)).toHaveLength(3); // rejected files are never stored
});

test("at most 3 files are read by the model at a time", async () => {
  let running = 0;
  let peak = 0;
  extractMock.mockImplementation(async () => {
    peak = Math.max(peak, ++running);
    await new Promise((r) => setTimeout(r, 10));
    running--;
    return { status: "needs_review", reason: "x" };
  });
  const { results } = await (await post(1, ...Array.from({ length: 8 }, (_, i) => ({ bytes: pdf(`file ${i}`) })))).json();
  expect(results).toHaveLength(8);
  expect(peak).toBe(3);
});

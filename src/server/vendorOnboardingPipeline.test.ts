import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as processRoute } from "@/app/api/invoices/[id]/process/route";
import { POST as create } from "@/app/api/vendors/route";
import { POST as approve } from "@/app/api/vendors/[id]/approve/route";
import { POST as hold } from "@/app/api/vendors/[id]/hold/route";
import { POST as release } from "@/app/api/vendors/[id]/release-hold/route";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";

// No network: the extractor is replaced.
vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const EMP = 1, CLERK = 2, APPR = 3, FIN = 4;
const invoice: ExtractedInvoice = {
  vendorName: "Northern Lights Supply Inc.", invoiceNumber: "INV-1", invoiceDate: "2026-11-01", dueDate: null, currency: "CAD",
  lines: [{ description: "Freight", quantity: "2", unitPriceCents: 5000, amountCents: 10000 }],
  taxes: [{ label: "HST 13%", code: "HST", amountCents: 1300 }], totalCents: 11300, poNumber: null, bankDetails: null, language: "en",
};
let dir: string;
let vendorId: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-onboarding-"));
  resetDbForTests();
  getDb().exec(`
    INSERT INTO users (id,name,role,approval_limit_cents,province) VALUES (1,'Emp','employee',0,'ON'),(2,'Clerk','ap_clerk',0,'ON'),(3,'Appr','approver',100000000,'ON'),(4,'Fin','finance_manager',0,'ON');
    INSERT INTO departments (id,name,manager_user_id) VALUES (1,'Ops',3);
    UPDATE users SET department_id = 1, manager_id = 3 WHERE id = 1;
    INSERT INTO tax_codes (code,province,rate_bps,applies_to) VALUES ('HST13','ON',1300,'all');
    INSERT INTO gl_accounts (id,code,name) VALUES (5010,'5010','Freight');
    INSERT INTO approval_policies (ext_id,rule_type,condition,required) VALUES
      ('P01','approval','Invoice total up to $10,000 CAD','dept_manager'),
      ('P02','approval','Invoice total over $10,000 CAD','dept_manager > finance_manager'),
      ('P03','approval','Invoice total over $50,000 CAD','dept_manager > finance_manager > controller_admin'),
      ('P04','approval','Invoice total over $250,000 CAD','dept_manager > finance_manager > controller_admin > cfo'),
      ('P05','approval','Vendor status is pending_review or the vendor is new','finance_manager');
  `);
  vi.mocked(extractInvoice).mockReset();
  const res = await create(post(CLERK, { name: "Northern Lights Supply Inc.", province_or_state: "ON", default_gl_account: "5010" }));
  vendorId = ((await res.json()) as { id: number }).id;
});

const post = (user: number, body?: unknown) => new Request("http://x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie: `session=${signSession(user)}` } });
const ctx = () => ({ params: Promise.resolve({ id: String(vendorId) }) });
// Reads one invoice for the vendor through the real pipeline and returns its status and flag codes.
async function readInvoice(n: number) {
  vi.mocked(extractInvoice).mockResolvedValue({ status: "ok", invoice: { ...invoice, invoiceNumber: `INV-${n}`, lines: [{ ...invoice.lines[0], quantity: String(n), amountCents: 5000 * n }], taxes: [{ ...invoice.taxes[0], amountCents: 650 * n }], totalCents: 5650 * n }, cached: false });
  const file = path.join(dir, `${n}.pdf`);
  fs.writeFileSync(file, `%PDF-1.4 ${n}`);
  const id = Number(getDb().prepare("INSERT INTO invoices (status,invoice_number,invoice_date,total_cents,currency,requester_id,source_file) VALUES ('received','','',0,'CAD',?,?)").run(EMP, file).lastInsertRowid);
  const res = await processRoute(post(CLERK), { params: Promise.resolve({ id: String(id) }) });
  expect(res.status).toBe(200);
  const row = getDb().prepare("SELECT status, flags FROM invoices WHERE id = ?").get(id) as { status: string; flags: string };
  return { status: row.status, flags: (JSON.parse(row.flags) as { code: string; severity: string }[]).filter((f) => f.code.startsWith("vendor_")) };
}

test("a vendor made through the API meets the existing vendor-status rules: pending warns, hold blocks, approval clears", async () => {
  const pending = await readInvoice(1);
  expect(pending.flags).toEqual([expect.objectContaining({ code: "vendor_pending_review", severity: "warning" })]);

  expect((await approve(post(FIN), ctx())).status).toBe(200);
  const approved = await readInvoice(2);
  expect(approved).toEqual({ status: "pending_approval", flags: [] });

  expect((await hold(post(FIN, { reason: "Checking ownership" }), ctx())).status).toBe(200);
  const held = await readInvoice(3);
  expect(held.flags).toEqual([expect.objectContaining({ code: "vendor_on_hold", severity: "error" })]);
  expect(held.status).toBe("needs_review");

  expect((await release(post(FIN), ctx())).status).toBe(200);
  expect(await readInvoice(4)).toEqual({ status: "pending_approval", flags: [] });
});

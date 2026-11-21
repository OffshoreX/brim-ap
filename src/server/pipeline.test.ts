import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as processRoute } from "@/app/api/invoices/[id]/process/route";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";

// No network: the extractor is replaced for every test.
vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";
const extractMock = vi.mocked(extractInvoice);

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const CLERK = 2;
const good: ExtractedInvoice = {
  vendorName: "Acme Freight Inc.",
  invoiceNumber: "INV-100",
  invoiceDate: "2026-11-01",
  dueDate: null,
  currency: "CAD",
  lines: [{ description: "Freight", quantity: "2", unitPriceCents: 5000, amountCents: 10000 }],
  taxes: [{ label: "GST", code: "GST", amountCents: 500 }],
  totalCents: 10500,
  poNumber: null,
  bankDetails: "123-456 / 00011",
  language: "en",
};
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-"));
  resetDbForTests();
  extractMock.mockReset();
  const db = getDb();
  db.exec(`
    INSERT INTO users (id,name,role,approval_limit_cents) VALUES
      (1,'Emp','employee',0),(2,'Clerk','ap_clerk',0),(3,'Appr','approver',100000000),(4,'Aud','auditor',0);
    INSERT INTO approval_rules (min_cents,max_cents,approver_role) VALUES (0,1000000000,'approver');
    INSERT INTO vendors (id,name) VALUES (1,'ACME Freight Inc');
    INSERT INTO vendor_bank_changes (vendor_id,changed_at,old_account_last4,new_account_last4) VALUES (1,'2025-01-01','9999','0011');
  `);
});

const makeInvoice = (name = "a.pdf") => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "%PDF-1.4 x");
  return Number(
    getDb().prepare("INSERT INTO invoices (status,invoice_number,invoice_date,total_cents,currency,requester_id,source_file) VALUES ('received','','',0,'CAD',1,?)").run(file).lastInsertRowid
  );
};
const run = (id: number, user: number | null = CLERK) =>
  processRoute(new Request("http://x", { method: "POST", headers: user ? { cookie: `session=${signSession(user)}` } : {} }), {
    params: Promise.resolve({ id: String(id) }),
  });
const row = (id: number) => getDb().prepare("SELECT * FROM invoices WHERE id = ?").get(id) as Record<string, unknown>;
const codes = (id: number) => (JSON.parse(row(id).flags as string) as { code: string }[]).map((f) => f.code);
const actions = (id: number) =>
  (getDb().prepare("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id").all(String(id)) as { action: string }[]).map((a) => a.action);
const ok = (invoice: Partial<ExtractedInvoice> = {}) =>
  extractMock.mockResolvedValue({ status: "ok", invoice: { ...good, ...invoice }, cached: false });

test("clean invoice is saved, routed to the approver and audited at every step", async () => {
  ok();
  const id = makeInvoice();
  const res = await run(id);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ invoiceId: id, status: "pending_approval", approverId: 3, flags: [] });
  expect(row(id)).toMatchObject({ status: "pending_approval", vendor_id: 1, invoice_number: "INV-100", total_cents: 10500, currency: "CAD" });
  expect(getDb().prepare("SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?").get(id)).toEqual({ n: 1 });
  expect(actions(id)).toEqual(["invoice.extracted", "invoice.coding_suggestion", "invoice.routed", "invoice.checks", "invoice.status"]);
});

test("same vendor and invoice number as an earlier invoice goes to needs_review with a duplicate flag", async () => {
  ok();
  const first = makeInvoice("a.pdf");
  await run(first);
  const second = makeInvoice("b.pdf");
  const body = await (await run(second)).json();
  expect(body.status).toBe("needs_review");
  expect(codes(second)).toContain("DUPLICATE_EXACT");
});

test("changed bank details go to needs_review with a bank flag", async () => {
  ok({ bankDetails: "999999 77777" });
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("needs_review");
  expect(codes(id)).toEqual(expect.arrayContaining(["bank_differs_from_latest", "bank_never_seen"]));
});

test("invoice with a still-pending new bank account is flagged as unverified", async () => {
  getDb().prepare("INSERT INTO vendor_bank_changes (vendor_id,changed_at,old_account_last4,new_account_last4,status) VALUES (1,'2026-11-01','0011','7777','pending')").run();
  ok({ bankDetails: "999999 77777" });
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("needs_review");
  expect(codes(id)).toContain("bank_change_unverified");
});

test("extraction failure goes to needs_review and nothing is guessed", async () => {
  extractMock.mockResolvedValue({ status: "needs_review", reason: "model output was not valid JSON" });
  const id = makeInvoice();
  expect((await (await run(id)).json()).status).toBe("needs_review");
  expect(codes(id)).toEqual(["extraction_failed"]);
  expect(row(id)).toMatchObject({ invoice_number: "", total_cents: 0, vendor_id: null });
  expect(actions(id)).toContain("invoice.extraction_failed");
});

test("an extractor that throws, or a missing file, also lands in needs_review", async () => {
  extractMock.mockRejectedValue(new Error("boom"));
  const a = makeInvoice("a.pdf");
  await run(a);
  expect(row(a).status).toBe("needs_review");
  const b = makeInvoice("b.pdf");
  fs.rmSync(path.join(dir, "b.pdf"));
  await run(b);
  expect(row(b).status).toBe("needs_review");
});

test("unknown vendor and a total that does not add up are flagged", async () => {
  ok({ vendorName: "Nobody Ltd", totalCents: 99999 });
  const id = makeInvoice();
  await run(id);
  expect(row(id).status).toBe("needs_review");
  expect(codes(id)).toEqual(expect.arrayContaining(["vendor_unmatched", "TOTAL_MISMATCH"]));
});

test("no approver can cover the amount: needs_review with a routing flag", async () => {
  ok({ lines: [{ description: "Big", quantity: "1", unitPriceCents: 2_000_000_000, amountCents: 2_000_000_000 }], taxes: [], totalCents: 2_000_000_000 });
  const id = makeInvoice();
  await run(id);
  expect(row(id).status).toBe("needs_review");
  expect(codes(id)).toContain("routing_failed");
});

test("roles: 401 without a session, 403 for others; 404 unknown; 409 on rerun", async () => {
  ok();
  const id = makeInvoice();
  expect((await run(id, null)).status).toBe(401);
  expect((await run(id, 1)).status).toBe(403);
  expect((await run(id, 4)).status).toBe(403);
  expect((await run(999)).status).toBe(404);
  expect((await run(id)).status).toBe(200);
  expect((await run(id)).status).toBe(409);
  expect(extractMock).toHaveBeenCalledTimes(1);
});

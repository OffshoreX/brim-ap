// A bill that was already paid by card (or bank) arrives again as a new invoice: the pipeline must catch it.
// Real imported dataset history in an in-memory DB; only the model call is mocked (no network).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as upload } from "@/app/api/invoices/upload/route";
import { POST as processInvoice } from "@/app/api/invoices/[id]/process/route";
import { getDb, resetDbForTests } from "@/server/db";
import { importDataset } from "@/server/importDataset";
import { signSession } from "@/server/session";

vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";
const extractMock = vi.mocked(extractInvoice);

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const CLERK = 4;
const EMPLOYEE = 13; // works in ON, so HST 13% below is the right tax

beforeEach(() => {
  resetDbForTests();
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cross-"));
  extractMock.mockReset();
  importDataset(getDb());
});

const as = (userId: number) => ({ cookie: `session=${signSession(userId)}` });
let n = 0;
async function uploadAs(userId: number): Promise<number> {
  const form = new FormData();
  form.append("file", new File([`%PDF-1.4 cross ${++n}`], "invoice.pdf", { type: "application/pdf" }));
  const res = await upload(new Request("http://x/api/invoices/upload", { method: "POST", headers: as(userId), body: form }));
  expect(res.status).toBe(200);
  return (await res.json())[0].invoiceId;
}
async function process_(invoice: ExtractedInvoice) {
  const id = await uploadAs(EMPLOYEE);
  extractMock.mockResolvedValueOnce({ status: "ok", invoice, cached: false });
  const res = await processInvoice(new Request("http://x", { method: "POST", headers: { ...as(CLERK), "content-type": "application/json" }, body: "{}" }), { params: Promise.resolve({ id: String(id) }) });
  expect(res.status).toBe(200);
  return (await res.json()) as { status: string; flags: { code: string }[] };
}

// An invoice for `v` whose total (HST 13% included) is exactly `totalCents`, under a number that has never been seen.
function billFor(v: { name: string; i: string; t: string; a: string }, totalCents: number, date: string): ExtractedInvoice {
  const subtotal = Math.round(totalCents / 1.13);
  const tax = totalCents - subtotal;
  return {
    vendorName: v.name, invoiceNumber: "RESENT-0001", invoiceDate: date, dueDate: null, currency: "CAD",
    lines: [{ description: "Services", quantity: "1", unitPriceCents: subtotal, amountCents: subtotal }],
    taxes: [{ label: "HST 13%", code: "HST", amountCents: tax }], totalCents, poNumber: null, bankDetails: `${v.i}-${v.t}-${v.a}`, language: "en",
  };
}

// First settled CAD payment of the given method in the dataset's own history, with its vendor, amount and paid date.
const history = (method: "CARD" | "EFT") =>
  getDb()
    .prepare(
      `SELECT p.id AS paymentId, p.amount_cad_cents AS cents, substr(p.paid_at,1,10) AS paidOn, v.name, v.bank_institution AS i, v.bank_transit AS t, v.bank_account AS a
       FROM payments p JOIN vendors v ON v.id = p.vendor_id
       WHERE p.method = ? AND p.status = 'settled' AND p.currency = 'CAD' AND p.paid_at IS NOT NULL AND p.amount_cad_cents > 10000 ORDER BY p.id LIMIT 1`
    )
    .get(method) as { paymentId: number; cents: number; paidOn: string; name: string; i: string; t: string; a: string };

test("an invoice already paid by card arrives again under a new number: flagged and sent to review", async () => {
  const h = history("CARD");
  const res = await process_(billFor(h, h.cents, h.paidOn));
  expect(res.status).toBe("needs_review");
  // The card charge itself is explained by our own payment row, so the rule that fires is the payment match.
  expect(res.flags.map((f) => f.code)).toContain("cross_paid_payment");
});

test("the same bill a year after the history is not flagged as a cross-payment", async () => {
  const h = history("CARD");
  // Recurring vendors repeat the same amount monthly, so the date must be past every payment in the dataset.
  const res = await process_(billFor(h, h.cents, "2027-12-01"));
  expect(res.flags.map((f) => f.code)).not.toContain("cross_paid_payment");
  expect(res.flags.map((f) => f.code)).not.toContain("cross_paid_card");
});

test("a card charge with no payment row of ours behind it is caught as cross_paid_card", async () => {
  const h = history("CARD");
  // Remove our own record of that payment, leaving only the card statement line: money left outside our books.
  getDb().prepare("DELETE FROM approvals WHERE invoice_id = (SELECT invoice_id FROM payments WHERE id = ?)").run(h.paymentId);
  getDb().prepare("DELETE FROM payments WHERE id = ?").run(h.paymentId);
  const res = await process_(billFor(h, h.cents, h.paidOn));
  expect(res.flags.map((f) => f.code)).toContain("cross_paid_card");
  expect(res.status).toBe("needs_review");
});

test("an unrelated payment on the same day does not hide a card charge (regression: unqualified column in the explained-by-payment check)", async () => {
  const h = history("CARD");
  getDb().prepare("DELETE FROM approvals WHERE invoice_id = (SELECT invoice_id FROM payments WHERE id = ?)").run(h.paymentId);
  getDb().prepare("DELETE FROM payments WHERE id = ?").run(h.paymentId);
  // Another vendor's payment, a different amount, same day: it must not "explain" the card line.
  const other = getDb().prepare("SELECT id FROM payments WHERE vendor_id != (SELECT id FROM vendors WHERE name = ?) AND status = 'settled' LIMIT 1").get(h.name) as { id: number };
  getDb().prepare("UPDATE payments SET paid_at = ? WHERE id = ?").run(h.paidOn, other.id);
  const res = await process_(billFor(h, h.cents, h.paidOn));
  expect(res.flags.map((f) => f.code)).toContain("cross_paid_card");
});

test("an invoice already paid by bank transfer arrives again: flagged as cross_paid_bank", async () => {
  const h = getDb()
    .prepare(
      `SELECT b.id AS bankId, b.debit_cents AS cents, b.posted_date AS postedOn, v.name, v.bank_institution AS i, v.bank_transit AS t, v.bank_account AS a
       FROM bank_statement b JOIN payments p ON p.amount_cad_cents = b.debit_cents AND p.method = 'EFT' AND p.status = 'settled'
       JOIN vendors v ON v.id = p.vendor_id WHERE b.debit_cents > 10000 AND p.currency = 'CAD' ORDER BY b.id LIMIT 1`
    )
    .get() as { bankId: number; cents: number; postedOn: string; name: string; i: string; t: string; a: string };
  // Drop our own payment rows for that amount so only the bank line remains as evidence.
  getDb().prepare("DELETE FROM approvals WHERE invoice_id IN (SELECT invoice_id FROM payments WHERE amount_cad_cents = ?)").run(h.cents);
  getDb().prepare("DELETE FROM payments WHERE amount_cad_cents = ?").run(h.cents);
  const res = await process_(billFor(h, h.cents, h.postedOn));
  expect(res.flags.map((f) => f.code)).toContain("cross_paid_bank");
  expect(res.status).toBe("needs_review");
});

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractInvoice } from "./extractInvoice";

const good = {
  vendorName: "Acme Ltd", invoiceNumber: "INV-1", invoiceDate: "2026-11-01", dueDate: "2026-12-01",
  currency: "CAD",
  lines: [{ description: "Freight", quantity: "2", unitPrice: "10.05", amount: "20.10" }],
  taxes: [{ label: "GST", code: "GST", amount: "1.01" }],
  total: "1234.50", poNumber: null, bankDetails: null, language: "en",
};
const reply = (obj: unknown) =>
  vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] })));

let dir: string;
const bytes = () => new TextEncoder().encode(`pdf-${Math.random()}`);
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-"));
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

test("good JSON becomes integer cents", async () => {
  vi.stubGlobal("fetch", reply(good));
  const r = await extractInvoice(bytes(), "application/pdf", { cacheDir: dir });
  expect(r.status).toBe("ok");
  if (r.status !== "ok") return;
  expect(r.invoice.totalCents).toBe(123450);
  expect(r.invoice.lines[0]).toMatchObject({ unitPriceCents: 1005, amountCents: 2010 });
  expect(r.invoice.taxes[0].amountCents).toBe(101);
});

test("non-JSON output -> needs_review", async () => {
  vi.stubGlobal("fetch", reply("sorry, I cannot read this"));
  expect((await extractInvoice(bytes(), "application/pdf", { cacheDir: dir })).status).toBe("needs_review");
});

test.each([
  ["malformed amount", { ...good, total: "12,34.5" }],
  ["float amount", { ...good, total: 12.5 }],
  ["too many decimals", { ...good, total: "1.005" }],
  ["bad currency", { ...good, currency: "EUR" }],
  ["impossible date", { ...good, invoiceDate: "2026-02-31" }],
  ["missing vendor", { ...good, vendorName: "" }],
])("%s -> needs_review", async (_n, bad) => {
  vi.stubGlobal("fetch", reply(bad));
  expect((await extractInvoice(bytes(), "application/pdf", { cacheDir: dir })).status).toBe("needs_review");
});

test("API error -> needs_review", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
  expect((await extractInvoice(bytes(), "application/pdf", { cacheDir: dir })).status).toBe("needs_review");
});

test("same bytes hit the cache, API called once", async () => {
  const f = reply(good);
  vi.stubGlobal("fetch", f);
  const b = bytes();
  const first = await extractInvoice(b, "application/pdf", { cacheDir: dir });
  const second = await extractInvoice(b, "application/pdf", { cacheDir: dir });
  expect(f).toHaveBeenCalledTimes(1);
  expect(first.status === "ok" && first.cached).toBe(false);
  expect(second.status === "ok" && second.cached).toBe(true);
});

test("missing key -> needs_review, no API call", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const f = reply(good);
  vi.stubGlobal("fetch", f);
  expect((await extractInvoice(bytes(), "application/pdf", { cacheDir: dir })).status).toBe("needs_review");
  expect(f).not.toHaveBeenCalled();
});

test("failures are not cached", async () => {
  vi.stubGlobal("fetch", reply("junk"));
  await extractInvoice(bytes(), "application/pdf", { cacheDir: dir });
  expect(fs.readdirSync(dir)).toHaveLength(0);
});

test("missing quantity means 1, missing unit price uses the amount, missing tax code is allowed", async () => {
  const sparse = { ...good, lines: [{ description: "Monthly fee", quantity: null, unitPrice: null, amount: "2400.00" }], taxes: [{ label: null, code: null, amount: "120.00" }] };
  vi.stubGlobal("fetch", reply(sparse));
  const r = await extractInvoice(bytes(), "application/pdf", { cacheDir: dir });
  expect(r.status).toBe("ok");
  if (r.status === "ok") {
    expect(r.invoice.lines[0]).toEqual({ description: "Monthly fee", quantity: "1", unitPriceCents: 240000, amountCents: 240000 });
    expect(r.invoice.taxes[0]).toEqual({ label: "Tax", code: "", amountCents: 12000 });
  }
});

test("numeric quantity from the model is accepted", async () => {
  vi.stubGlobal("fetch", reply({ ...good, lines: [{ description: "Item", quantity: 3, unitPrice: "1.00", amount: "3.00" }] }));
  const r = await extractInvoice(bytes(), "application/pdf", { cacheDir: dir });
  expect(r.status === "ok" && r.invoice.lines[0].quantity).toBe("3");
});

test("an answer that fails the checks is saved, and the same file is not sent again", async () => {
  const bad = { ...good, currency: "EUR" };
  const f = reply(bad);
  vi.stubGlobal("fetch", f);
  const b = bytes();
  expect((await extractInvoice(b, "application/pdf", { cacheDir: dir })).status).toBe("needs_review");
  expect((await extractInvoice(b, "application/pdf", { cacheDir: dir })).status).toBe("needs_review");
  expect(f).toHaveBeenCalledTimes(1);
  expect(fs.readdirSync(dir)).toHaveLength(1);
});

test("EXTRACT_RETRY=1 asks the model again about an invalid saved answer", async () => {
  const b = bytes();
  vi.stubGlobal("fetch", reply({ ...good, currency: "EUR" }));
  await extractInvoice(b, "application/pdf", { cacheDir: dir });
  const f = reply(good);
  vi.stubGlobal("fetch", f);
  process.env.EXTRACT_RETRY = "1";
  try {
    const r = await extractInvoice(b, "application/pdf", { cacheDir: dir });
    expect(r.status).toBe("ok");
    expect(f).toHaveBeenCalledTimes(1);
  } finally {
    delete process.env.EXTRACT_RETRY;
  }
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";

// Answers fetch from a table of path -> [status, json, headers]; records each call (body kept as sent, FormData included).
function stubFetch(table: Record<string, [number, unknown, Record<string, string>?]>) {
  const calls: { path: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : (init.body ?? null);
    calls.push({ path: url, method: init.method ?? "GET", body, headers: (init.headers ?? {}) as Record<string, string> });
    const hit = table[url];
    if (!hit) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: hit[0], headers: hit[2] ?? {} });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("approvals, exceptions, payments and upload adapters", () => {
  it("pages the approvals inbox from X-Total-Count", async () => {
    stubFetch({ "/api/approvals/inbox?limit=25&offset=25": [200, [{ invoiceId: 9 }], { "X-Total-Count": "27" }] });
    const page = await api.approvalsInbox({ limit: 25, offset: 25 });
    expect(page.total).toBe(27);
    expect(page.items).toHaveLength(1);
  });

  it("fills exceptions from the invoice detail and falls back to warnings when the detail call fails", async () => {
    const row = { id: 1, invoiceNumber: "A-1", vendorId: 2, totalCents: 500, currency: "CAD", flags: [{ code: "po_missing", message: "No purchase order" }] };
    stubFetch({
      "/api/exceptions?limit=25&offset=0": [200, [row, { ...row, id: 2 }], { "X-Total-Count": "2" }],
      "/api/invoices/1": [200, { vendorName: "Acme", dueDate: "2026-11-30", flags: [{ code: "po_missing", message: "No purchase order", severity: "error" }] }],
      // invoice 2 has no detail (404)
    });
    const page = await api.exceptions({ limit: 25, offset: 0 });
    expect(page.items[0]).toMatchObject({ vendorName: "Acme", dueDate: "2026-11-30", flags: [{ severity: "error" }] });
    expect(page.items[1]).toMatchObject({ vendorName: null, dueDate: null, flags: [{ code: "po_missing", severity: "warning" }] });
  });

  it("counts new invoices and skipped emails from the import rows", async () => {
    stubFetch({ "/api/inbox/import": [200, [{ emailId: "a", class: "invoice", invoiceIds: [5, 6], flags: [] }, { emailId: "b", class: "invoice", invoiceIds: [], flags: [], skipped: "already_imported" }]] });
    expect(await api.importInbox()).toEqual({ imported: 2, skipped: 1 });
  });

  it("sends a fresh Idempotency-Key on every approve, prepare and release click", async () => {
    const calls = stubFetch({ "/api/invoices/5/decision": [200, {}], "/api/payments/prepare": [200, {}], "/api/payments/release": [200, {}] });
    await api.decide(5, "approved");
    await api.decide(5, "approved");
    await api.preparePayment(8);
    await api.releaseScheduled(11);
    expect(calls[2]!.body).toEqual({ invoiceId: 8 });
    expect(new Set(calls.map((c) => c.headers["Idempotency-Key"])).size).toBe(4);
  });

  it("uploads as multipart with a key and returns the one result", async () => {
    const calls = stubFetch({ "/api/invoices/upload": [200, { results: [{ file: "a.pdf", invoiceId: 7, status: "pending_approval", flags: [], error: null }] }] });
    const r = await api.upload(new File(["x"], "a.pdf", { type: "application/pdf" }));
    expect(r.invoiceId).toBe(7);
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    expect(calls[0]!.headers["Idempotency-Key"]).toBeTruthy();
    expect(calls[0]!.headers["Content-Type"]).toBeUndefined(); // the browser must set the multipart boundary itself
  });

  it("turns a refused file (a 200 with error set) into the server's own sentence", async () => {
    stubFetch({ "/api/invoices/upload": [200, { results: [{ file: "x.txt", invoiceId: null, status: "error", flags: [], error: "Only PDF, PNG, JPG or WebP files are accepted" }] }] });
    await expect(api.upload(new File(["x"], "x.txt"))).rejects.toMatchObject({ message: "Only PDF, PNG, JPG or WebP files are accepted" });
  });
});

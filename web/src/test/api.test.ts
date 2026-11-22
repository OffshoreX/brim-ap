import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/roles";

// Answers fetch from a table of path -> [status, json, headers]; records each call.
function stubFetch(table: Record<string, [number, unknown, Record<string, string>?]>) {
  const calls: { path: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ path: url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null, headers: (init.headers ?? {}) as Record<string, string> });
    const hit = table[url];
    if (!hit) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: hit[0], headers: hit[2] ?? {} });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("api adapters", () => {
  it("unwraps { user } from /me and keeps only the columns the app uses", async () => {
    stubFetch({ "/api/me": [200, { user: { id: 3, name: "Elise", email: "e@x", title: null, role: "finance_manager", approval_limit_cents: 5 } }] });
    expect(await api.me()).toEqual({ id: 3, name: "Elise", email: "e@x", title: null, role: "finance_manager" });
  });

  it("shows the server's own error text, not a rewritten one", async () => {
    stubFetch({ "/api/login": [401, { error: "Wrong email or password" }] });
    await expect(api.login("a@b", "nope")).rejects.toMatchObject({ message: "Wrong email or password", status: 401 });
    await expect(api.login("a@b", "nope")).rejects.toBeInstanceOf(ApiError);
  });

  it("pages the invoice list from X-Total-Count and fills vendor name and due date from each detail", async () => {
    const row = { id: 7, status: "paid", vendorId: 2, invoiceNumber: "A-1", invoiceDate: "2026-10-01", totalCents: 1000, currency: "CAD", requesterId: 1, sourceFile: null };
    stubFetch({
      "/api/invoices?status=paid&limit=25&offset=0": [200, [row, { ...row, id: 8 }], { "X-Total-Count": "394" }],
      "/api/invoices/7": [200, { vendorName: "Acme", dueDate: "2026-10-31", flags: [{}, {}] }],
      // invoice 8 has no detail (404): the row must survive with nulls
    });
    const page = await api.invoices({ status: "paid", limit: 25, offset: 0 });
    expect(page.total).toBe(394);
    expect(page.items[0]).toMatchObject({ vendorName: "Acme", dueDate: "2026-10-31", flagCount: 2 });
    expect(page.items[1]).toMatchObject({ id: 8, vendorName: null, dueDate: null, flagCount: null });
  });

  it("sends past-tense decisions and a payment id for release, with an idempotency key on release", async () => {
    const calls = stubFetch({ "/api/invoices/5/decision": [200, {}], "/api/payments/release": [200, {}] });
    await api.decide(5, "approved", "ok");
    await api.releaseScheduled(11);
    expect(calls[0]!.body).toEqual({ decision: "approved", comment: "ok" });
    expect(calls[1]!.body).toEqual({ paymentId: 11 });
    expect(calls[1]!.headers["Idempotency-Key"]).toBeTruthy();
  });

  it("reshapes the report rows into cents and counts", async () => {
    stubFetch({
      "/api/reports/aging": [200, [{ bucket: "0-30", invoices: 5, totalCadCents: 1574195 }]],
      "/api/reports/spend?limit=8": [200, [{ key: "Acme", invoices: 2, totalCadCents: 900 }]],
    });
    expect((await api.aging()).buckets[0]).toEqual({ label: "0-30 days past due", amountCents: 1574195, count: 5 });
    expect((await api.spend()).rows[0]).toEqual({ vendorName: "Acme", amountCents: 900 });
  });
});

describe("roles", () => {
  it("matches the server's route gates for the buttons on the invoice page", () => {
    expect(can("approver", "decide")).toBe(true);
    expect(can("ap_clerk", "decide")).toBe(false); // /api/invoices/:id/decision
    expect(can("finance_manager", "release")).toBe(true);
    expect(can("ap_clerk", "release")).toBe(false); // /api/payments/release
    expect(can("employee", "trail")).toBe(false); // /api/invoices/:id/trail
    expect(can("auditor", "reports")).toBe(true);
  });
});

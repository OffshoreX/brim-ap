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

  it("pages the invoice list from X-Total-Count and makes one call, reading the new list fields", async () => {
    const row = { id: 7, status: "paid", vendorId: 2, invoiceNumber: "A-1", invoiceDate: "2026-10-01", totalCents: 1000, currency: "CAD", requesterId: 1, sourceFile: null, vendorName: "Acme", dueDate: "2026-10-31", flagCount: 2 };
    const unread = { ...row, id: 8, status: "received", vendorId: null, invoiceNumber: "", invoiceDate: "", vendorName: null, dueDate: null, flagCount: 0, sourceFile: "a.pdf" };
    const calls = stubFetch({ "/api/invoices?status=paid&limit=25&offset=0": [200, [row, unread], { "X-Total-Count": "394" }] });
    const page = await api.invoices({ status: "paid", limit: 25, offset: 0 });
    expect(page.total).toBe(394);
    expect(page.items[0]).toMatchObject({ vendorName: "Acme", dueDate: "2026-10-31", flagCount: 2 });
    expect(page.items[1]).toMatchObject({ id: 8, vendorName: null, dueDate: null, sourceFile: "a.pdf" });
    expect(calls).toHaveLength(1); // no per-row /invoices/:id calls
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
      "/api/reports/spend?by=vendor&limit=8": [200, [{ key: "Acme", invoices: 2, totalCadCents: 900 }], { "X-Total-Count": "52" }],
    });
    expect((await api.aging()).buckets[0]).toEqual({ label: "0-30 days past due", amountCents: 1574195, count: 5 });
    const sp = await api.spend("vendor");
    expect(sp.rows[0]).toEqual({ label: "Acme", amountCents: 900, count: 2 });
    expect(sp.total).toBe(52);
  });
});

describe("vendor, audit and rule calls", () => {
  it("sends the fields the server really wants for a bank change and its callback result", async () => {
    const calls = stubFetch({ "/api/vendors/4/bank-change": [201, {}], "/api/vendors/4/bank-change/verify": [200, {}] });
    await api.requestBankChange(4, { institution: "003", transit: "12345", account: "99887766", channel: "phone" });
    await api.verifyBankChange(4, false);
    expect(calls[0]!.body).toEqual({ institution: "003", transit: "12345", account: "99887766", channel: "phone" });
    expect(calls[1]!.body).toEqual({ verified: false });
    expect(calls[1]!.headers["Idempotency-Key"]).toBeTruthy();
  });

  it("unwraps approval rules and sends only over_cents", async () => {
    const calls = stubFetch({
      "/api/admin/approval-rules": [200, { rules: [{ id: 1, policy_id: "P02", over_cents: 1000000, extra_role: "finance_manager" }] }],
      "/api/admin/approval-rules/1": [200, { rule: { id: 1, policy_id: "P02", over_cents: 1200000, extra_role: "finance_manager" } }],
    });
    expect((await api.approvalRules())[0]).toMatchObject({ id: 1, over_cents: 1000000 });
    expect((await api.updateApprovalRule(1, 1200000)).rule.over_cents).toBe(1200000);
    expect(calls[1]).toMatchObject({ method: "PUT", body: { over_cents: 1200000 } });
  });

  it("pages the audit log from X-Total-Count and returns the chain verdict untouched", async () => {
    stubFetch({
      "/api/audit?limit=50&offset=0": [200, [{ id: 9 }], { "X-Total-Count": "1284" }],
      "/api/audit/verify": [200, { ok: false, rowCount: 12, brokenAtId: 12, reason: "row contents do not match its hash (row was edited)" }],
    });
    expect((await api.audit({ limit: 50, offset: 0 })).total).toBe(1284);
    expect(await api.auditVerify()).toMatchObject({ ok: false, brokenAtId: 12 });
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
    expect(can("auditor", "runReconciliation")).toBe(false); // POST /api/reconciliation
    expect(can("finance_manager", "auditVerify")).toBe(false); // GET /api/audit/verify
    expect(can("controller_admin", "admin")).toBe(true);
  });
});

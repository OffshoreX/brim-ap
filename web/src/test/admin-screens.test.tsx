import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VendorStatus } from "@/components/VendorStatus";
import { api } from "@/lib/api";
import { toCents } from "@/lib/format";
import { can } from "@/lib/roles";
import { EMPTY, fieldOfError, vendorBody } from "@/lib/vendorForm";
import type { Me, VendorDetail } from "@/lib/types";

// Answers fetch from a table of "METHOD path" -> [status, body, headers]; records each call.
function stubFetch(table: Record<string, [number, unknown, Record<string, string>?]>) {
  const calls: { path: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ path: url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : null, headers: (init.headers ?? {}) as Record<string, string> });
    const hit = table[`${method} ${url}`];
    if (!hit) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    const body = typeof hit[1] === "string" ? hit[1] : JSON.stringify(hit[1]);
    return new Response(body, { status: hit[0], headers: hit[2] ?? {} });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("vendor onboarding and user admin adapters", () => {
  it("creates a vendor with one idempotency key and the body as typed", async () => {
    const calls = stubFetch({ "POST /api/vendors": [201, { id: 61, status: "pending_review" }] });
    await api.createVendor({ name: "Acme", requires_po: false });
    expect(calls[0]!.body).toEqual({ name: "Acme", requires_po: false });
    expect(calls[0]!.headers["Idempotency-Key"]).toBeTruthy();
  });

  it("sends the hold reason, and approve and lift hold with no body", async () => {
    const calls = stubFetch({ "POST /api/vendors/5/hold": [200, {}], "POST /api/vendors/5/approve": [200, {}], "POST /api/vendors/5/release-hold": [200, {}] });
    await api.holdVendor(5, "bank letter looks forged");
    await api.approveVendor(5);
    await api.releaseVendorHold(5);
    expect(calls.map((c) => c.body)).toEqual([{ reason: "bank letter looks forged" }, null, null]);
  });

  it("shows the server's refusal word for word", async () => {
    stubFetch({ "POST /api/vendors/5/approve": [403, { error: "You created this vendor, so someone else must approve it" }] });
    await expect(api.approveVendor(5)).rejects.toMatchObject({ status: 403, message: "You created this vendor, so someone else must approve it" });
  });

  it("unwraps { users } and sends only the patch to PATCH /users/:id", async () => {
    const u = { id: 2, name: "Elise", email: null, title: null, role: "finance_manager", status: "active", managerId: null, approvalLimitCents: 500000, delegateUserId: null };
    const calls = stubFetch({ "GET /api/users": [200, { users: [u] }], "PATCH /api/users/2": [200, { ...u, role: "approver" }] });
    expect(await api.adminUsers()).toEqual([u]);
    expect((await api.updateUser(2, { role: "approver" })).role).toBe("approver");
    expect(calls[1]!.body).toEqual({ role: "approver" });
  });

  it("returns the journal CSV as text and the server's message on a bad range", async () => {
    stubFetch({
      "GET /api/export/journal?from=2026-01-01&to=2026-12-31": [200, "entry_id,date\nJE-1,2026-02-01\n"],
      "GET /api/export/journal?from=2026-12-31&to=2026-01-01": [400, { error: "from must not be after to" }],
    });
    expect(await api.exportJournal("2026-01-01", "2026-12-31")).toBe("entry_id,date\nJE-1,2026-02-01\n");
    await expect(api.exportJournal("2026-12-31", "2026-01-01")).rejects.toMatchObject({ message: "from must not be after to" });
  });
});

describe("vendor form", () => {
  it("puts each server message next to the field it names", () => {
    expect(fieldOfError("payment_terms_days must be a whole number from 0 to 365")).toBe("payment_terms_days");
    expect(fieldOfError("default_gl_account 9999 is not a known GL account")).toBe("default_gl_account");
    expect(fieldOfError('A vendor with this name already exists: "Acme" (vendor 3)')).toBe("name");
    expect(fieldOfError("Not accepted when creating a vendor: bank_account")).toBeNull();
  });

  it("leaves empty boxes out and sends terms as a number, or as typed when it is not one", () => {
    expect(vendorBody({ ...EMPTY, name: " Acme ", category: "Fuel", payment_terms_days: "30", country: "CA" })).toEqual({ name: "Acme", requires_po: false, category: "Fuel", country: "CA", payment_terms_days: 30 });
    expect(vendorBody({ ...EMPTY, name: "A", payment_terms_days: "abc" }).payment_terms_days).toBe("abc");
  });
});

describe("roles and money", () => {
  it("copies the server's role lists for the new routes", () => {
    expect(["employee", "approver", "auditor"].some((r) => can(r as Me["role"], "createVendor"))).toBe(false);
    expect(can("ap_clerk", "createVendor")).toBe(true);
    expect(can("ap_clerk", "vendorDecide")).toBe(false);
    expect(can("finance_manager", "vendorDecide")).toBe(true);
  });

  it("turns a typed limit into whole cents and refuses anything else", () => {
    expect(toCents("5000.50")).toBe(500050);
    expect(toCents("5,000")).toBeNull();
  });
});

describe("vendor status buttons", () => {
  const me = (role: Me["role"], id = 1): Me => ({ id, name: "X", email: "x@y", title: null, role });
  const vendor = (status: string, by: number | null = 9) => ({ id: 5, name: "Acme", status, created_by_user_id: by, bankChanges: [] }) as unknown as VendorDetail;
  const show = (v: VendorDetail, m: Me) => render(<QueryClientProvider client={new QueryClient()}><VendorStatus v={v} me={m} /></QueryClientProvider>);

  it("shows Approve to a finance manager who did not create the vendor", () => {
    show(vendor("pending_review"), me("finance_manager"));
    expect(screen.getByRole("button", { name: "Approve vendor" })).toBeTruthy();
  });
  it("hides Approve from the creator and from a clerk", () => {
    const a = show(vendor("pending_review", 1), me("controller_admin", 1));
    expect(screen.queryByRole("button", { name: "Approve vendor" })).toBeNull();
    a.unmount();
    show(vendor("pending_review"), me("ap_clerk"));
    expect(screen.queryByRole("button", { name: "Approve vendor" })).toBeNull();
  });
  it("offers Lift hold only on a held vendor", () => {
    show(vendor("on_hold"), me("controller_admin"));
    expect(screen.getByRole("button", { name: "Lift hold" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hold vendor" })).toBeNull();
  });
});

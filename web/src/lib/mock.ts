// Sample data. Loaded ONLY when VITE_USE_MOCKS === "true" (see api.ts). Never mixed with real responses.
import { INVOICE_STATUSES, RECON_CATEGORIES } from "./types";
import type * as T from "./types";

type Res = { status: number; data?: unknown; total?: number; error?: string };

// Real vendor rows (snake_case, last4 only). The first one has a pending bank change asked for by the clerk (user 4).
const mkVendor = (id: number, name: string, email: string, method: string, last4: string, status: string, category: string): T.Vendor => ({
  id, ext_id: `V${String(id).padStart(3, "0")}`, name, category, default_gl_account: "5100", address: `${id * 11} Dock Rd, Vancouver BC`, province_or_state: "BC", country: "CA",
  gst_hst_number: `${100000000 + id}RT0001`, qst_number: null, payment_terms_days: 30, early_pay_discount: id === 4 ? "2/10 net 30" : null, preferred_payment_method: method, accepts_card_payment: 0,
  bank_institution: "004", bank_transit: "95688", bank_details_updated_at: null, ap_contact_email: email, requires_po: 0, status, onboarded_at: "2022-11-08", currency: "CAD", bank_account_last4: last4,
});
const VENDORS: T.VendorDetail[] = [
  { ...mkVendor(1, "Pacific Fuel Supply Ltd.", "ar@pacificfuel.ca", "EFT", "4421", "active", "Fuel & Freight"), bankChanges: [{ id: 1, changed_at: "2026-11-18T15:10:00.000Z", changed_by_user_id: 4, request_channel: "email", status: "pending", verified_by_callback: 0, old_account_last4: "4421", new_account_last4: "9032", verified_by_user_id: null, verified_at: null }] },
  { ...mkVendor(2, "Northshore Tire & Fleet Service", "billing@northshoretire.com", "EFT", "1180", "active", "Fleet"), bankChanges: [] },
  { ...mkVendor(3, "Harbour Crane Rentals", "accounts@harbourcrane.ca", "CHEQUE", "", "active", "Equipment"), bankChanges: [] },
  { ...mkVendor(4, "Coastal Pallet Co.", "ap@coastalpallet.ca", "EFT", "7765", "on_hold", "Packaging"), bankChanges: [{ id: 2, changed_at: "2026-09-02T10:00:00.000Z", changed_by_user_id: 4, request_channel: "phone", status: "applied", verified_by_callback: 1, old_account_last4: "1234", new_account_last4: "7765", verified_by_user_id: 3, verified_at: "2026-09-02T11:00:00.000Z" }] },
  { ...mkVendor(5, "Strait Telecom", "invoices@straittel.ca", "EFT", "2290", "pending_review", "Telecom"), bankChanges: [] },
];

// Real shapes: ids are numbers, statuses are the server's seven, flags are {code, message, severity}.
const STATUSES: T.InvoiceStatus[] = ["needs_review", "pending_approval", "approved", "scheduled", "paid", "received", "rejected"];
const GL = [{ glCode: "5100", glName: "Fuel" }, { glCode: "5150", glName: "Freight in" }];

function buildInvoices(): T.InvoiceDetail[] {
  const out: T.InvoiceDetail[] = [];
  for (let i = 0; i < 64; i++) {
    const vi = i % VENDORS.length;
    const v = VENDORS[vi]!;
    const status = STATUSES[i % STATUSES.length]!;
    const total = 48_000 + ((i * 7919) % 2_400_000);
    const tax = Math.round(total * 0.12 / 1.12);
    const first = Math.round((total - tax) * 0.7);
    const day = 1 + (i % 28);
    const flags: T.Flag[] = [];
    if (status === "needs_review") flags.push({ code: "bank_changed", severity: "error", message: "Vendor bank details changed 3 days ago and have not been verified by callback." }, { code: "DUPLICATE_NEAR", severity: "warning", message: `Same amount and vendor as INV-${2400 + i - 5} received last week.` }, { code: "no_po", severity: "info", message: "No purchase order number found on the document." });
    if (status === "pending_approval" && i % 2) flags.push({ code: "late_filing", severity: "warning", message: "Invoice date is more than 30 days before it was received." });
    const decided = ["approved", "scheduled", "paid"].includes(status);
    out.push({
      id: i + 1,
      status,
      invoiceNumber: `INV-${2400 + i}`,
      vendorId: vi + 1,
      vendorName: v.name,
      invoiceDate: `2026-10-${String(day).padStart(2, "0")}`,
      dueDate: `2026-11-${String(day).padStart(2, "0")}`,
      subtotalCents: total - tax,
      gstHstCents: tax,
      pstQstCents: 0,
      totalCents: total,
      currency: "CAD",
      totalCadCents: total,
      requesterId: 13,
      sourceFile: null,
      sourceEmail: i % 3 === 0 ? { emailId: `E${i}`, from: v.ap_contact_email ?? "ap@vendor.example", subject: `Invoice INV-${2400 + i}`, receivedAt: `2026-10-${String(day).padStart(2, "0")}T09:00:00` } : null,
      extraction: null,
      flags,
      vendor: { id: vi + 1, name: v.name, category: "Fuel & Freight", status: "active", paymentTermsDays: 30, province: "BC", currency: "CAD" },
      lines: [
        { lineNo: 1, lineType: "goods", description: "Marine diesel, 2,000 L", quantity: 1, unitPriceCents: first, amountCents: first, currency: "CAD", taxCents: 0, gstHstCode: "GST5", pstQstCode: null, ...GL[0]! },
        { lineNo: 2, lineType: "services", description: "Delivery & handling", quantity: 1, unitPriceCents: total - tax - first, amountCents: total - tax - first, currency: "CAD", taxCents: 0, gstHstCode: "GST5", pstQstCode: null, glCode: i % 3 ? "5150" : null, glName: i % 3 ? "Freight in" : null },
      ],
      approvalChain: status === "received" || status === "needs_review" ? [] : [
        { stepNo: 1, role: "approver", roleLabel: "Approver", userId: 7, userName: "Marcus Lee", delegatedFromId: null, delegatedFromName: null, reason: null, status: "approved" },
        { stepNo: 2, role: "finance_manager", roleLabel: "Finance manager", userId: i % 4 === 1 ? 1 : 3, userName: i % 4 === 1 ? "Dana Okafor" : "Elise Tremblay", delegatedFromId: null, delegatedFromName: null, reason: null, status: status === "pending_approval" ? "pending" : status === "rejected" ? "rejected" : "approved" },
      ],
      approvals: decided || status === "rejected" ? [{ id: i * 2 + 1, stepNo: 1, approverId: 7, approverRole: "approver", decision: "approved", decidedAt: "2026-11-02T14:00:00", comment: null, delegated: 0 }] : [],
      payments: status === "scheduled" ? [{ id: i + 1, method: "EFT", methodLabel: "EFT", status: "scheduled", statusLabel: "Scheduled", scheduledDate: `2026-11-${String(day).padStart(2, "0")}`, paidAt: null, amountCents: total, currency: "CAD", reference: `BRIM-EFT-${1000 + i}` }]
        : status === "paid" ? [{ id: i + 1, method: "EFT", methodLabel: "EFT", status: "settled", statusLabel: "Paid", scheduledDate: `2026-11-${String(day).padStart(2, "0")}`, paidAt: `2026-11-${String(day).padStart(2, "0")}T10:00:00`, amountCents: total, currency: "CAD", reference: `PAY-${i + 1}` }] : [],
    });
  }
  return out;
}

interface Store { invoices: T.InvoiceDetail[]; rules: T.ApprovalRule[]; uploads: Record<string, number> }
let store: Store | null = null;
function db(): Store {
  if (!store) {
    const invoices = buildInvoices();
    store = {
      invoices,
      rules: [
        { id: 1, policy_id: "P02", over_cents: 1_000_000, extra_role: "finance_manager" },
        { id: 2, policy_id: "P03", over_cents: 5_000_000, extra_role: "controller_admin" },
        { id: 3, policy_id: "P04", over_cents: 25_000_000, extra_role: "cfo" },
      ],
      uploads: {},
    };
  }
  return store;
}

// /api/me returns the whole users row; /api/login returns only { id, name, role }.
const ME = { id: 1, name: "Dana Okafor", email: "dana@harborline.ca", title: "Controller", role: "controller_admin" } as const satisfies T.Me;
// Payments are not stored apart: like the server's /api/payments they are every invoice's payments, oldest first.
const allPayments = (s: Store): T.Payment[] =>
  s.invoices.flatMap((i) => i.payments.map((p): T.Payment => ({
    id: p.id, invoiceId: i.id, invoiceNumber: i.invoiceNumber, vendorId: i.vendorId, vendorName: i.vendorName, invoiceTotalCents: i.totalCents,
    method: p.method, status: p.status, scheduledDate: p.scheduledDate, paidAt: p.paidAt, amountCents: p.amountCents, currency: p.currency,
    reference: p.reference, methodLabel: p.methodLabel, statusLabel: p.statusLabel,
  }))).sort((a, b) => a.id - b.id);
// An invoice as the server creates it on upload or import: just received, nothing extracted yet.
const newInvoice = (s: Store): T.InvoiceDetail => {
  const id = Math.max(...s.invoices.map((i) => i.id)) + 1;
  const inv: T.InvoiceDetail = { ...s.invoices[0]!, id, invoiceNumber: `INV-${3000 + id}`, status: "received", flags: [], approvalChain: [], approvals: [], payments: [] };
  s.invoices.push(inv);
  return inv;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const listItem = (i: T.InvoiceDetail): T.InvoiceListItem => ({ id: i.id, status: i.status, vendorId: i.vendorId, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, totalCents: i.totalCents, currency: i.currency, requesterId: i.requesterId, sourceFile: i.sourceFile, vendorName: i.vendorName, dueDate: i.dueDate, flagCount: i.flags.length });

const PIPELINE = ["received_file", "read_text", "matched_vendor", "extracted_lines", "checked_duplicates", "checked_bank", "applied_rules"];
const stepsFor = (i: T.InvoiceDetail, n: number): T.ProcessStep[] =>
  PIPELINE.slice(0, n).map((step, k) => {
    const flagged = k === 4 && i.flags.length > 0;
    return { id: i.id * 100 + k, step, status: flagged ? "flagged" : "ok", detail: flagged ? "Possible duplicate found" : "Done", durationMs: 40 + k * 15, createdAt: "2026-11-01T09:13:00" };
  });

export async function mockRequest(method: string, fullPath: string, body: unknown): Promise<Res> {
  await new Promise((r) => setTimeout(r, 180));
  const s = db();
  const [path = "", query = ""] = fullPath.split("?");
  const q = new URLSearchParams(query);
  const seg = path.split("/").filter(Boolean);
  const inv = (id: string) => s.invoices.find((i) => String(i.id) === id);

  if (path === "/login") return { status: 200, data: { user: { id: ME.id, name: ME.name, role: ME.role } } };
  if (path === "/logout") return { status: 200, data: { ok: true } };
  if (path === "/me") return { status: 200, data: { user: ME } };
  if (path === "/dashboard") {
    const countsByStatus: Partial<Record<T.InvoiceStatus, number>> = {};
    for (const i of s.invoices) countsByStatus[i.status] = (countsByStatus[i.status] ?? 0) + 1;
    return { status: 200, data: { countsByStatus, needsReview: countsByStatus.needs_review ?? 0, dueThisWeekCadCents: 628_026 } satisfies T.Dashboard };
  }
  if (path === "/invoices/counts") {
    const byStatus = Object.fromEntries(INVOICE_STATUSES.map((st) => [st, 0])) as T.InvoiceCounts["byStatus"];
    for (const i of s.invoices) byStatus[i.status] += 1;
    return { status: 200, data: { total: s.invoices.length, byStatus } satisfies T.InvoiceCounts };
  }
  if (path === "/invoices" && method === "GET") {
    const st = q.get("status");
    if (st && !(INVOICE_STATUSES as readonly string[]).includes(st)) return { status: 400, error: `Unknown status: ${st}` };
    const all = s.invoices.filter((i) => !st || i.status === st).sort((a, b) => b.id - a.id).map(listItem); // newest first, like the server
    const limit = Math.min(Number(q.get("limit") ?? 50), 200);
    const offset = Number(q.get("offset") ?? 0);
    return { status: 200, data: all.slice(offset, offset + limit), total: all.length };
  }
  if (path === "/invoices/upload") {
    const name = (body as { name?: string } | undefined)?.name ?? "invoice.pdf";
    if (/\.txt$/i.test(name)) return { status: 200, data: { results: [{ file: name, invoiceId: null, status: "error", flags: [], error: "Only PDF, PNG, JPG or WebP files are accepted" }] } };
    const inv = newInvoice(s); // made at once, like the server, so the page can find it while the request is still open
    s.uploads[String(inv.id)] = Date.now();
    await sleep(PIPELINE.length * 900 + 200); // the real request also stays open until every step has run
    inv.status = "pending_approval";
    return { status: 200, data: { results: [{ file: name, invoiceId: inv.id, status: inv.status, flags: [], error: null }] } };
  }
  if (seg[0] === "invoices" && seg[1]) {
    const i = inv(seg[1]);
    if (!i) return { status: 404, error: "Invoice not found" };
    if (seg.length === 2) return { status: 200, data: i };
    if (seg[2] === "trail") return { status: 200, data: [
      { id: 1, at: "2026-11-01T09:12:00", actorId: null, actorName: "System", action: "invoice.received", entity: "invoice", entityId: String(i.id), before: null, after: null },
      { id: 2, at: "2026-11-02T14:00:00", actorId: 7, actorName: "Marcus Lee", action: "approval.decide", entity: "invoice", entityId: String(i.id), before: null, after: null },
    ] satisfies T.TrailEntry[] };
    if (seg[2] === "process-log") {
      const started = s.uploads[String(i.id)];
      const n = started ? Math.min(PIPELINE.length, Math.floor((Date.now() - started) / 900) + 1) : PIPELINE.length;
      if (started && n >= PIPELINE.length && i.status === "received") i.status = "pending_approval";
      return { status: 200, data: stepsFor(i, n) };
    }
    if (seg[2] === "decision") {
      const d = (body as { decision: string }).decision;
      if (d !== "approved" && d !== "rejected") return { status: 400, error: "decision must be approved or rejected" };
      if (i.status !== "pending_approval") return { status: 409, error: `Invoice is ${i.status}, not pending_approval` };
      i.status = d === "approved" ? "approved" : "rejected";
      for (const st of i.approvalChain) if (st.status === "pending") st.status = d;
      return { status: 200, data: { invoiceId: i.id, status: i.status, decision: d, stepNo: 1, nextApproverId: null, delegated: false, delegatedFromId: null } satisfies T.DecisionResult };
    }
    if (seg[2] === "process") return { status: 200, data: { invoiceId: i.id, status: i.status } };
  }
  if (path === "/payments/release") {
    const id = (body as { paymentId?: number }).paymentId;
    const i = s.invoices.find((x) => x.payments.some((p) => p.id === id && p.status === "scheduled"));
    if (!i) return { status: 409, error: "Payment is not scheduled" };
    i.status = "paid";
    for (const p of i.payments) if (p.id === id) Object.assign(p, { status: "settled", statusLabel: "Paid", paidAt: new Date().toISOString() });
    const paid = i.payments.find((p) => p.id === id)!;
    return { status: 200, data: { paymentId: paid.id, invoiceId: i.id, status: "paid", method: paid.method, reference: paid.reference ?? "", discountCents: 0 } satisfies T.ReleaseResult };
  }
  if (path === "/reports/aging") return { status: 200, data: [{ bucket: "0-30", invoices: 5, totalCadCents: 1_574_195 }, { bucket: "31-60", invoices: 2, totalCadCents: 310_000 }, { bucket: "61-90", invoices: 0, totalCadCents: 0 }, { bucket: "90+", invoices: 0, totalCadCents: 0 }] };
  if (path === "/reports/spend") {
    const by = q.get("by") ?? "vendor";
    const groups: Record<string, [string, number, number][]> = {
      vendor: VENDORS.map((v, k) => [v.name, 10 - k, [12_400_000, 6_210_000, 4_800_500, 2_150_000, 990_000][k]!]),
      department: [["Operations", 143, 67_933_378], ["Facilities", 99, 64_380_270], ["IT", 53, 15_260_580]],
      month: [["2026-03", 51, 23_899_346], ["2026-09", 42, 23_005_115], ["2026-07", 43, 22_610_891]],
    };
    const g = groups[by];
    if (!g) return { status: 400, error: "by must be vendor, department or month" };
    return { status: 200, data: g.slice(0, Number(q.get("limit") ?? 50)).map(([key, invoices, totalCadCents]) => ({ key, invoices, totalCadCents })), total: g.length };
  }
  if (path === "/process-log") return { status: 200, data: s.invoices.slice(0, Number(q.get("limit") ?? 20)).map((i, k) => ({ ...stepsFor(i, 5)[k % 5]!, id: k + 1, invoiceId: i.id, invoiceNumber: i.invoiceNumber, createdAt: `2026-11-21T${String(16 - (k % 10)).padStart(2, "0")}:0${k % 6}:00` })) };
  // Lists below are paged like the server: ?limit=&offset= and the total in X-Total-Count.
  const slice = (rows: unknown[]): Res => {
    const limit = Math.min(Number(q.get("limit") ?? 50), 200);
    const offset = Number(q.get("offset") ?? 0);
    return { status: 200, data: rows.slice(offset, offset + limit), total: rows.length };
  };
  if (path === "/approvals/inbox") return slice(s.invoices.filter((i) => i.status === "pending_approval").map((i, k): T.InboxItem => ({
    invoiceId: i.id, stepNo: 2, role: "finance_manager", reason: i.totalCents > 500_000 ? "P03 amount over the manager limit" : "P01 department manager", delegatedFromId: null,
    invoiceNumber: i.invoiceNumber, vendorId: i.vendorId, vendorName: i.vendorName, totalCents: i.totalCents, currency: i.currency, invoiceDate: i.invoiceDate,
    dueDate: i.dueDate, totalCadCents: i.totalCadCents, ageDays: 2 + k, flagCount: i.flags.length, topFlag: i.flags[0] ?? null,
  })));
  if (path === "/exceptions") return slice(s.invoices.filter((i) => i.status === "needs_review").map((i): T.ExceptionListItem => ({
    id: i.id, invoiceNumber: i.invoiceNumber, vendorId: i.vendorId, totalCents: i.totalCents, currency: i.currency, flags: i.flags.map((f) => ({ code: f.code, message: f.message })),
  })));
  if (path === "/exceptions/historical") return slice([
    { invoiceId: 36, invoiceRef: "AP-00036", paymentId: null, code: "missing_step_P05", label: "Required step skipped: new or pending-review vendor (P05)", reason: "finance_manager step required (P05 vendor onboarded within 60 days) but not recorded", readOnly: true },
    { invoiceId: 52, invoiceRef: "AP-00052", paymentId: 52, code: "duplicate_payment", label: "Paid twice", reason: "Two payments of the same amount to the same vendor within 3 days", readOnly: true },
  ] satisfies T.HistoricalException[]);
  if (seg[0] === "exceptions" && seg[2] === "resolve") {
    const i = inv(seg[1]!);
    if (!i) return { status: 404, error: "Invoice not found" };
    if (i.status !== "needs_review") return { status: 409, error: `Invoice is ${i.status}, not needs_review` };
    const reject = (body as { action: string }).action === "reject";
    i.status = reject ? "rejected" : "pending_approval";
    return { status: 200, data: { invoiceId: i.id, status: i.status } satisfies T.ResolveResult };
  }
  if (path === "/inbox/import") {
    const made = newInvoice(s);
    return { status: 200, data: [
      { emailId: "EM-101", class: "invoice", invoiceIds: [made.id], flags: [] },
      { emailId: "EM-002", class: "invoice", invoiceIds: [], flags: [], skipped: "already_imported" },
    ] satisfies T.ImportRow[] };
  }
  if (path === "/inbox/other") return slice([
    { emailId: "EM-056", from: "ar@polarfreight.example", subject: "Statement of account - October 2026", receivedAt: "2026-11-02T09:14:00", class: "statement", reason: null, attachments: [], flags: [] },
    { emailId: "EM-057", from: "ar@torqueindustrial.example", subject: "Where is payment for invoice 1743?", receivedAt: "2026-10-30T14:36:00", class: "payment_inquiry", reason: null, attachments: [], flags: [] },
    { emailId: "EM-029", from: "ar@orionstrategy.example", subject: "Facture 279", receivedAt: "2026-10-29T15:33:00", class: "invoice", reason: null, attachments: ["a.pdf", "b.pdf"], flags: ["possible_duplicate_attachments"] },
  ] satisfies T.OtherInboxEmail[]);
  if (path === "/payments") return slice(allPayments(s));
  if (path === "/payments/ready") return slice(s.invoices.filter((i) => i.status === "approved").map((i): T.ReadyToPay => ({
    invoiceId: i.id, invoiceNumber: i.invoiceNumber, vendorName: i.vendorName, totalCents: i.totalCents, currency: i.currency, dueDate: i.dueDate,
    suggestedMethod: { method: "EFT", label: "EFT", reason: "Vendor's preferred method is EFT" }, earlyPayDiscountCents: i.id % 5 === 0 ? 2_400 : null,
  })));
  if (path === "/payments/prepare") {
    const i = inv(String((body as { invoiceId: number }).invoiceId));
    if (!i) return { status: 404, error: "Invoice not found" };
    if (i.status !== "approved") return { status: 409, error: `Invoice is ${i.status}, not approved` };
    const id = Math.max(0, ...allPayments(s).map((p) => p.id)) + 1;
    const scheduledDate = i.dueDate ?? "2026-11-30";
    i.payments.push({ id, method: "EFT", methodLabel: "EFT", status: "scheduled", statusLabel: "Scheduled", scheduledDate, paidAt: null, amountCents: i.totalCents, currency: i.currency, reference: `BRIM-EFT-${id}` });
    i.status = "scheduled";
    return { status: 200, data: { paymentId: id, invoiceId: i.id, status: "scheduled", method: "EFT", scheduledDate, earlyPay: false, notes: [] } satisfies T.PrepareResult };
  }
  if (path === "/reconciliation" && method === "POST") return { status: 200, data: { changed: 2, summary: reconSummary() } satisfies T.ReconciliationRun };
  if (path === "/reconciliation") {
    const cat = q.get("category");
    if (cat && !(T_CATS as readonly string[]).includes(cat)) return { status: 400, error: "unknown category" };
    const rows = RECON.filter((r) => !cat || r.category === cat);
    const limit = Math.min(Number(q.get("limit") ?? 50), 200);
    const offset = Number(q.get("offset") ?? 0);
    return { status: 200, data: { summary: reconSummary(), total: rows.length, rows: rows.slice(offset, offset + limit) } satisfies T.Reconciliation, total: rows.length };
  }
  if (path === "/reports/discounts") return { status: 200, data: [
    { vendor: "Coastal Pallet Co.", terms: "2/10 net 30", takenPayments: 1, takenCadCents: 7_077, missedPayments: 4, missedCadCents: 54_208 },
    { vendor: "Northshore Tire & Fleet Service", terms: "2/10 net 30", takenPayments: 7, takenCadCents: 12_710, missedPayments: 3, missedCadCents: 5_902 },
  ] satisfies T.DiscountRow[] };
  if (path === "/vendors") return { status: 200, data: VENDORS.map(({ bankChanges: _b, ...v }) => v) };
  if (seg[0] === "vendors" && seg[1]) {
    const v = VENDORS.find((x) => String(x.id) === seg[1]);
    if (!v) return { status: 404, error: "Vendor not found" };
    const pending = v.bankChanges.find((c) => c.status === "pending");
    if (seg[2] === "bank-change" && seg[3] === "verify") {
      if (typeof (body as { verified?: unknown })?.verified !== "boolean") return { status: 400, error: "verified must be true or false" };
      if (!pending) return { status: 409, error: "No pending bank change for this vendor (already verified or rejected)" };
      if (pending.changed_by_user_id === ME.id) return { status: 403, error: "You cannot verify your own bank-change request" };
      const ok = (body as { verified: boolean }).verified;
      Object.assign(pending, { status: ok ? "applied" : "rejected", verified_by_callback: ok ? 1 : 0, verified_by_user_id: ME.id, verified_at: new Date().toISOString() });
      if (ok) v.bank_account_last4 = pending.new_account_last4 ?? v.bank_account_last4;
      return { status: 200, data: { id: pending.id, vendorId: v.id, status: pending.status } };
    }
    if (seg[2] === "bank-change") {
      const b = (body ?? {}) as Record<string, unknown>;
      if (!["institution", "transit", "account", "channel"].every((k) => typeof b[k] === "string" && String(b[k]).trim() !== "")) return { status: 400, error: "institution, transit, account and channel are required strings" };
      if (pending) return { status: 409, error: "A bank change is already pending for this vendor" };
      const id = v.bankChanges.length + 10;
      v.bankChanges.push({ id, changed_at: new Date().toISOString(), changed_by_user_id: ME.id, request_channel: String(b["channel"]), status: "pending", verified_by_callback: 0, old_account_last4: v.bank_account_last4, new_account_last4: String(b["account"]).slice(-4), verified_by_user_id: null, verified_at: null });
      return { status: 201, data: { id, vendorId: v.id, status: "pending", oldLast4: v.bank_account_last4, newLast4: String(b["account"]).slice(-4) } };
    }
    return { status: 200, data: v };
  }
  if (path === "/audit") {
    const limit = Math.min(Number(q.get("limit") ?? 50), 200);
    const offset = Number(q.get("offset") ?? 0);
    const rows: T.TrailEntry[] = Array.from({ length: 120 }, (_, k) => ({ id: 120 - k, at: `2026-11-${String(21 - (k % 20)).padStart(2, "0")}T1${k % 10}:00:00.000Z`, actorId: k % 4 + 1, actorName: ["Priya Raman", "Elise Tremblay", "Jordan Okafor", "Dev Malhotra"][k % 4]!, action: ["invoice.decision", "invoice.upload", "vendor.bank_change_requested", "payment.release"][k % 4]!, entity: ["invoice", "invoice", "vendor_bank_change", "payment"][k % 4]!, entityId: String(400 - k), before: k % 2 ? { status: "pending_approval" } : null, after: { status: "approved" } }));
    return { status: 200, data: rows.slice(offset, offset + limit), total: rows.length };
  }
  if (path === "/audit/verify") return { status: 200, data: { ok: true, rowCount: 120, headHash: "3212bc049a4ae965d3fb989a9c9b72cc64b0b461cb6ff6aff0d9417499d9c258" } satisfies T.AuditVerify };
  if (path === "/users") return { status: 200, data: { users: [{ ...ME, status: "active", managerId: null, approvalLimitCents: 0, delegateUserId: null }] satisfies T.ManagedUser[] } };
  if (path === "/admin/approval-rules") return { status: 200, data: { rules: s.rules } };
  if (seg[0] === "admin" && seg[1] === "approval-rules" && seg[2]) {
    const r = s.rules.find((x) => String(x.id) === seg[2]);
    if (!r) return { status: 404, error: "Rule not found" };
    const over = (body as { over_cents?: unknown } | null)?.over_cents;
    if (!Number.isSafeInteger(over) || (over as number) < 0) return { status: 400, error: "over_cents must be an integer number of cents, >= 0" };
    const next = s.rules.map((x) => (x.id === r.id ? { ...x, over_cents: over as number } : x));
    if (!(next[0]!.over_cents <= next[1]!.over_cents && next[1]!.over_cents <= next[2]!.over_cents)) return { status: 400, error: "thresholds must rise: finance_manager <= controller_admin <= cfo" };
    r.over_cents = over as number;
    return { status: 200, data: { rule: r } };
  }
  if (path.endsWith("eft-file") || path.endsWith("cheques")) return { status: 200, data: "" };
  return { status: 404, error: `No sample data for ${path}.` };
}

const T_CATS = RECON_CATEGORIES;
const bank = (category: T.ReconCategory, k: number, over: Partial<T.ReconRow> = {}): T.ReconRow => ({
  category, paymentId: 100 + k, invoiceNumber: `INV-${2400 + k}`, vendor: VENDORS[k % VENDORS.length]!.name, method: "EFT", paymentCents: 187_580 + k * 1000, lineSource: "bank", lineId: `BK-${String(k).padStart(5, "0")}`,
  lineText: "EFT PMT SAMPLE VENDOR", lineDate: `2026-01-${String(1 + (k % 28)).padStart(2, "0")}`, lineCents: 187_580 + k * 1000, diffCents: 0, note: "", ...over,
});
const RECON: T.ReconRow[] = [
  ...Array.from({ length: 60 }, (_, k) => bank("matched", k)),
  bank("amount_diff", 61, { lineCents: 462_007, paymentCents: 462_006, diffCents: 1, note: "line BK-00061 for the same payee differs by 1 cents" }),
  { ...bank("payment_unmatched", 62), lineSource: null, lineId: null, lineText: null, lineDate: null, lineCents: null, diffCents: null, method: "CHEQUE", note: "no cheque line for this amount within 30 days (may still be outstanding)" },
  { category: "card_no_payment", paymentId: null, invoiceNumber: null, vendor: null, method: null, paymentCents: null, lineSource: "card", lineId: "CT-00017", lineText: "PAPER TRAIL OFFICE SUP", lineDate: "2026-01-12", lineCents: 207_945, diffCents: null, note: "card charge to a known vendor with no payment on file" },
];
const reconSummary = () => Object.fromEntries(T_CATS.map((c) => [c, RECON.filter((r) => r.category === c).length])) as T.Reconciliation["summary"];

// Sample data. Loaded ONLY when VITE_USE_MOCKS === "true" (see api.ts). Never mixed with real responses.
import { INVOICE_STATUSES } from "./types";
import type * as T from "./types";

type Res = { status: number; data?: unknown; total?: number; error?: string };

const VENDORS: T.VendorDetail[] = [
  { id: "1", name: "Pacific Fuel Supply Ltd.", email: "ar@pacificfuel.ca", paymentMethod: "eft", bankLast4: "4421", status: "active", pendingBankChange: true, address: "88 Dock Rd, Vancouver BC", bankChange: { id: "bc1", requestedBy: "Priya Shah", requestedAt: "2026-11-18T15:10:00Z", newBankLast4: "9032", status: "pending_verification" } },
  { id: "2", name: "Northshore Tire & Fleet Service", email: "billing@northshoretire.com", paymentMethod: "eft", bankLast4: "1180", status: "active", pendingBankChange: false, address: "12 Esplanade, North Vancouver BC", bankChange: null },
  { id: "3", name: "Harbour Crane Rentals", email: "accounts@harbourcrane.ca", paymentMethod: "cheque", bankLast4: null, status: "active", pendingBankChange: false, address: "400 Port Way, Delta BC", bankChange: null },
  { id: "4", name: "Coastal Pallet Co.", email: "ap@coastalpallet.ca", paymentMethod: "eft", bankLast4: "7765", status: "on_hold", pendingBankChange: false, address: "9 Mill St, Richmond BC", bankChange: null },
  { id: "5", name: "Strait Telecom", email: "invoices@straittel.ca", paymentMethod: "eft", bankLast4: "2290", status: "active", pendingBankChange: false, address: "1 Signal Hill, Surrey BC", bankChange: null },
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
      sourceEmail: i % 3 === 0 ? { emailId: `E${i}`, from: v.email ?? "ap@vendor.example", subject: `Invoice INV-${2400 + i}`, receivedAt: `2026-10-${String(day).padStart(2, "0")}T09:00:00` } : null,
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

interface Store { invoices: T.InvoiceDetail[]; payments: T.Payment[]; rules: T.ApprovalRule[]; uploads: Record<string, number> }
let store: Store | null = null;
function db(): Store {
  if (!store) {
    const invoices = buildInvoices();
    store = {
      invoices,
      payments: invoices.filter((i) => i.status === "scheduled" || i.status === "paid").slice(0, 10).map((i) => ({
        id: `p${i.id}`, invoiceId: String(i.id), invoiceNumber: i.invoiceNumber, vendorName: i.vendorName ?? "", amountCents: i.totalCents, currency: i.currency,
        method: "eft", status: i.status === "paid" ? "settled" : "scheduled", scheduledFor: i.dueDate,
      })),
      rules: [
        { id: "r1", name: "Small invoices", minCents: 0, maxCents: 500_000, currency: "CAD", approverRole: "approver", steps: 1 },
        { id: "r2", name: "Mid-size", minCents: 500_000, maxCents: 2_500_000, currency: "CAD", approverRole: "finance_manager", steps: 2 },
        { id: "r3", name: "Large", minCents: 2_500_000, maxCents: null, currency: "CAD", approverRole: "controller_admin", steps: 3 },
      ],
      uploads: {},
    };
  }
  return store;
}

// /api/me returns the whole users row; /api/login returns only { id, name, role }.
const ME = { id: 1, name: "Dana Okafor", email: "dana@harborline.ca", title: "Controller", role: "controller_admin" } as const satisfies T.Me;
// Old-shaped summary for the pages that have not been moved to the real shapes yet (approvals, exceptions, payments).
const summary = (i: T.InvoiceDetail): T.InvoiceSummary => ({ id: String(i.id), invoiceNumber: i.invoiceNumber, vendorId: String(i.vendorId), vendorName: i.vendorName ?? "", invoiceDate: i.invoiceDate, dueDate: i.dueDate ?? "", status: i.status, totalCents: i.totalCents, currency: i.currency, flagCount: i.flags.length });
const listItem = (i: T.InvoiceDetail): T.InvoiceListItem => ({ id: i.id, status: i.status, vendorId: i.vendorId, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, totalCents: i.totalCents, currency: i.currency, requesterId: i.requesterId, sourceFile: i.sourceFile });

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
    const base = s.invoices[0]!;
    const id = s.invoices.length + 1;
    s.invoices.push({ ...base, id, invoiceNumber: `INV-${3000 + id}`, status: "received", flags: [], approvalChain: [], approvals: [], payments: [] });
    s.uploads[String(id)] = Date.now();
    return { status: 200, data: summary(s.invoices[id - 1]!) };
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
      return { status: 200, data: { invoiceId: i.id, status: i.status } };
    }
    if (seg[2] === "process") return { status: 200, data: { invoiceId: i.id, status: i.status } };
  }
  if (path === "/payments/release") {
    const id = (body as { paymentId?: number }).paymentId;
    const i = s.invoices.find((x) => x.payments.some((p) => p.id === id && p.status === "scheduled"));
    if (!i) return { status: 409, error: "Payment is not scheduled" };
    i.status = "paid";
    for (const p of i.payments) if (p.id === id) Object.assign(p, { status: "settled", statusLabel: "Paid", paidAt: new Date().toISOString() });
    return { status: 200, data: { paymentId: id, status: "settled" } };
  }
  if (path === "/reports/aging") return { status: 200, data: [{ bucket: "0-30", invoices: 5, totalCadCents: 1_574_195 }, { bucket: "31-60", invoices: 2, totalCadCents: 310_000 }, { bucket: "61-90", invoices: 0, totalCadCents: 0 }, { bucket: "90+", invoices: 0, totalCadCents: 0 }] };
  if (path === "/reports/spend") return { status: 200, data: VENDORS.map((v, k) => ({ key: v.name, invoices: 10 - k, totalCadCents: [12_400_000, 6_210_000, 4_800_500, 2_150_000, 990_000][k]! })).slice(0, Number(q.get("limit") ?? 50)) };
  if (path === "/process-log") return { status: 200, data: s.invoices.slice(0, Number(q.get("limit") ?? 20)).map((i, k) => ({ ...stepsFor(i, 5)[k % 5]!, id: k + 1, invoiceId: i.id, invoiceNumber: i.invoiceNumber, createdAt: `2026-11-21T${String(16 - (k % 10)).padStart(2, "0")}:0${k % 6}:00` })) };
  if (path === "/approvals/inbox") return { status: 200, data: s.invoices.filter((i) => i.status === "pending_approval").slice(0, 12).map((i, k) => ({ ...summary(i), ageDays: 2 + k, flags: i.flags, whyYou: i.totalCents > 500_000 ? "Over 5,000.00 CAD — finance sign-off" : "You approve this vendor" })) };
  if (path === "/exceptions") return { status: 200, data: s.invoices.filter((i) => i.status === "needs_review").slice(0, 8).map((i) => ({ id: `ex-${i.id}`, invoice: summary(i), flags: i.flags, createdAt: "2026-11-15T10:00:00Z" })) };
  if (path === "/exceptions/historical") return { status: 200, data: [{ id: "h1", invoiceNumber: "INV-2311", vendorName: "Strait Telecom", resolution: "sent_to_approval", resolvedBy: "Priya Shah", resolvedAt: "2026-11-10T12:00:00Z", note: "PO confirmed by ops." }] };
  if (seg[0] === "exceptions" && seg[2] === "resolve") {
    const i = inv(seg[1]!.replace("ex-", ""));
    if (i) { i.status = (body as { action: string }).action === "reject" ? "rejected" : "pending_approval"; i.flags = []; }
    return { status: 200, data: {} };
  }
  if (path === "/inbox/import") return { status: 200, data: { imported: 3 } };
  if (path === "/inbox/other") return { status: 200, data: [{ id: "e1", from: "newsletter@fleetnews.com", subject: "November fleet digest", receivedAt: "2026-11-20T08:00:00Z", reason: "No invoice attachment" }] };
  if (path === "/payments") return { status: 200, data: s.payments };
  if (path === "/payments/ready") return { status: 200, data: s.invoices.filter((i) => i.status === "approved").map((i) => ({ ...summary(i), method: "eft" })) };
  if (path === "/payments/prepare") {
    const i = inv(String((body as { invoiceId: string | number }).invoiceId));
    if (!i) return { status: 404, error: "Invoice not found" };
    if (!s.payments.some((p) => p.invoiceId === String(i.id))) s.payments.unshift({ id: `p${Date.now()}`, invoiceId: String(i.id), invoiceNumber: i.invoiceNumber, vendorName: i.vendorName ?? "", amountCents: i.totalCents, currency: i.currency, method: "eft", status: "scheduled", scheduledFor: i.dueDate });
    i.status = "scheduled";
    return { status: 200, data: {} };
  }
  if (path === "/reconciliation") return { status: 200, data: recon() };
  if (path === "/reports/discounts") return { status: 200, data: { currency: "CAD", rows: [{ invoiceNumber: "INV-2402", vendorName: "Northshore Tire & Fleet Service", discountCents: 24_000, deadline: "2026-11-25", captured: false }, { invoiceNumber: "INV-2390", vendorName: "Coastal Pallet Co.", discountCents: 9_500, deadline: "2026-11-12", captured: true }] } };
  if (path === "/vendors") return { status: 200, data: VENDORS };
  if (seg[0] === "vendors" && seg[1]) {
    const v = VENDORS.find((x) => x.id === seg[1]);
    if (!v) return { status: 404, error: "Vendor not found." };
    if (seg[2] === "bank-change" && seg[3] === "verify") { if (v.bankChange) v.bankChange.status = "verified"; v.pendingBankChange = false; return { status: 200, data: v }; }
    if (seg[2] === "bank-change") { const a = String((body as { account?: string }).account ?? "0000"); v.bankChange = { id: `bc${Date.now()}`, requestedBy: ME.name, requestedAt: new Date().toISOString(), newBankLast4: a.slice(-4), status: "pending_verification" }; v.pendingBankChange = true; return { status: 200, data: v }; }
    if (method === "PATCH") Object.assign(v, body);
    return { status: 200, data: v };
  }
  if (path === "/audit") return { status: 200, data: Array.from({ length: 15 }, (_, k) => ({ id: `au${k}`, at: `2026-11-${String(20 - k).padStart(2, "0")}T1${k % 10}:00:00Z`, actorName: ["Dana Okafor", "Priya Shah", "Marcus Lee", "System"][k % 4]!, action: ["approve", "upload", "code_line", "prepare_payment"][k % 4]!, entity: `INV-${2400 + k}`, hash: `9f${(k * 2654435761 >>> 0).toString(16).padStart(8, "0")}` })) };
  if (path === "/audit/verify") return { status: 200, data: { ok: true, checked: 1284, message: "All 1,284 entries link correctly." } };
  if (path === "/users") return { status: 200, data: [ME] };
  if (path === "/admin/approval-rules") return { status: 200, data: s.rules };
  if (seg[0] === "admin" && seg[2]) { const r = s.rules.find((x) => x.id === seg[2]); if (r) Object.assign(r, body); return { status: 200, data: r }; }
  if (path.endsWith("eft-file") || path.endsWith("cheques")) return { status: 200, data: "" };
  return { status: 404, error: `No sample data for ${path}.` };
}

function recon(): T.Reconciliation {
  return { periodLabel: "November 2026", matchedCount: 212, unmatchedCount: 4, matchedCents: 31_204_550, unmatchedCents: 412_300, currency: "CAD", lastRunAt: "2026-11-21T06:00:00Z" };
}

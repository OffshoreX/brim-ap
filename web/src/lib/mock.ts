// Sample data. Loaded ONLY when VITE_USE_MOCKS === "true" (see api.ts). Never mixed with real responses.
import type * as T from "./types";

type Res = { status: number; data?: unknown; total?: number; error?: string };

const VENDORS: T.VendorDetail[] = [
  { id: "v1", name: "Pacific Fuel Supply Ltd.", email: "ar@pacificfuel.ca", paymentMethod: "eft", bankLast4: "4421", status: "active", pendingBankChange: true, address: "88 Dock Rd, Vancouver BC", bankChange: { id: "bc1", requestedBy: "Priya Shah", requestedAt: "2026-11-18T15:10:00Z", newBankLast4: "9032", status: "pending_verification" } },
  { id: "v2", name: "Northshore Tire & Fleet Service", email: "billing@northshoretire.com", paymentMethod: "eft", bankLast4: "1180", status: "active", pendingBankChange: false, address: "12 Esplanade, North Vancouver BC", bankChange: null },
  { id: "v3", name: "Harbour Crane Rentals", email: "accounts@harbourcrane.ca", paymentMethod: "cheque", bankLast4: null, status: "active", pendingBankChange: false, address: "400 Port Way, Delta BC", bankChange: null },
  { id: "v4", name: "Coastal Pallet Co.", email: "ap@coastalpallet.ca", paymentMethod: "eft", bankLast4: "7765", status: "on_hold", pendingBankChange: false, address: "9 Mill St, Richmond BC", bankChange: null },
  { id: "v5", name: "Strait Telecom", email: "invoices@straittel.ca", paymentMethod: "eft", bankLast4: "2290", status: "active", pendingBankChange: false, address: "1 Signal Hill, Surrey BC", bankChange: null },
];

const STATUSES: T.InvoiceStatus[] = ["needs_review", "pending_approval", "approved", "blocked", "scheduled", "paid", "received", "rejected"];

function buildInvoices(): T.InvoiceDetail[] {
  const out: T.InvoiceDetail[] = [];
  for (let i = 0; i < 64; i++) {
    const v = VENDORS[i % VENDORS.length]!;
    const status = STATUSES[i % STATUSES.length]!;
    const total = 48_000 + ((i * 7919) % 2_400_000);
    const tax = Math.round(total * 0.12 / 1.12);
    const day = 1 + (i % 28);
    const flags: T.Flag[] = [];
    if (status === "blocked") flags.push({ id: `f${i}a`, code: "bank_changed", severity: "block", reason: "Vendor bank details changed 3 days ago and have not been verified by callback." });
    if (status === "blocked" || status === "needs_review") flags.push({ id: `f${i}b`, code: "possible_duplicate", severity: "warn", reason: `Same amount and vendor as INV-${2400 + i - 5} received last week.` });
    if (status === "needs_review") flags.push({ id: `f${i}c`, code: "no_po", severity: "info", reason: "No purchase order number found on the document." });
    out.push({
      id: `inv${i + 1}`,
      invoiceNumber: `INV-${2400 + i}`,
      vendorId: v.id,
      vendorName: v.name,
      invoiceDate: `2026-10-${String(day).padStart(2, "0")}`,
      dueDate: `2026-11-${String(day).padStart(2, "0")}`,
      status,
      totalCents: total,
      currency: "CAD",
      flagCount: flags.length,
      subtotalCents: total - tax,
      taxCents: tax,
      paymentMethod: v.paymentMethod,
      flags,
      lines: [
        { id: `l${i}1`, description: "Marine diesel, 2,000 L", quantity: 1, unitPriceCents: Math.round((total - tax) * 0.7), amountCents: Math.round((total - tax) * 0.7), glAccount: "5100 Fuel", costCenter: "OPS-VAN" },
        { id: `l${i}2`, description: "Delivery & handling", quantity: 1, unitPriceCents: total - tax - Math.round((total - tax) * 0.7), amountCents: total - tax - Math.round((total - tax) * 0.7), glAccount: i % 3 ? "5150 Freight in" : null, costCenter: i % 3 ? "OPS-VAN" : null },
      ],
      approvals: [
        { id: `a${i}1`, order: 1, approverName: "Marcus Lee", approverRole: "approver", status: ["approved", "scheduled", "paid"].includes(status) || status === "pending_approval" ? "approved" : "waiting", decidedAt: "2026-11-02T14:00:00Z", comment: null },
        { id: `a${i}2`, order: 2, approverName: "Dana Okafor", approverRole: "finance_manager", status: status === "pending_approval" ? "pending" : ["approved", "scheduled", "paid"].includes(status) ? "approved" : status === "rejected" ? "rejected" : "waiting", decidedAt: null, comment: status === "rejected" ? "Pricing doesn't match contract." : null },
      ],
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
      payments: invoices.filter((i) => i.status === "scheduled" || i.status === "paid").slice(0, 10).map((i, k) => ({
        id: `p${k}`, invoiceId: i.id, invoiceNumber: i.invoiceNumber, vendorName: i.vendorName, amountCents: i.totalCents, currency: i.currency,
        method: i.paymentMethod === "cheque" ? "cheque" : "eft", status: i.status === "paid" ? "settled" : "scheduled", scheduledFor: i.dueDate,
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

const ME: T.Me = { id: "u1", email: "dana@harborline.ca", name: "Dana Okafor", role: "controller_admin" };
const summary = (i: T.InvoiceDetail): T.InvoiceSummary => ({ id: i.id, invoiceNumber: i.invoiceNumber, vendorId: i.vendorId, vendorName: i.vendorName, invoiceDate: i.invoiceDate, dueDate: i.dueDate, status: i.status, totalCents: i.totalCents, currency: i.currency, flagCount: i.flags.length });

const PIPELINE = ["Received file", "Read document text", "Matched vendor", "Extracted line items", "Checked duplicates", "Checked bank details", "Applied approval rules"];

export async function mockRequest(method: string, fullPath: string, body: unknown): Promise<Res> {
  await new Promise((r) => setTimeout(r, 180));
  const s = db();
  const [path = "", query = ""] = fullPath.split("?");
  const q = new URLSearchParams(query);
  const seg = path.split("/").filter(Boolean);
  const inv = (id: string) => s.invoices.find((i) => i.id === id);

  if (path === "/login") return { status: 200, data: ME };
  if (path === "/logout") return { status: 404, error: "Not found" };
  if (path === "/me") return { status: 200, data: ME };
  if (path === "/dashboard") return { status: 200, data: { reconciliation: recon() } };
  if (path === "/invoices/counts") {
    const byStatus: Partial<Record<T.InvoiceStatus, number>> = {};
    for (const i of s.invoices) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    return { status: 200, data: { total: s.invoices.length, byStatus } };
  }
  if (path === "/invoices" && method === "GET") {
    const st = q.get("status");
    const all = s.invoices.filter((i) => !st || i.status === st).map(summary);
    const limit = Math.min(Number(q.get("limit") ?? 50), 200);
    const offset = Number(q.get("offset") ?? 0);
    return { status: 200, data: all.slice(offset, offset + limit), total: all.length };
  }
  if (path === "/invoices/upload") {
    const id = `inv${s.invoices.length + 1}`;
    const base = s.invoices[0]!;
    s.invoices.unshift({ ...base, id, invoiceNumber: `INV-${3000 + s.invoices.length}`, status: "processing", flags: [] });
    s.uploads[id] = Date.now();
    return { status: 200, data: summary(s.invoices[0]!) };
  }
  if (seg[0] === "invoices" && seg[1]) {
    const i = inv(seg[1]);
    if (!i) return { status: 404, error: "Invoice not found." };
    if (seg.length === 2) return { status: 200, data: i };
    if (seg[2] === "trail") return { status: 200, data: [
      { id: "t1", at: "2026-11-01T09:12:00Z", actorName: "System", action: "Received", detail: "Imported from ap@harborline.ca" },
      { id: "t2", at: "2026-11-01T09:13:00Z", actorName: "System", action: "Processed", detail: `${i.flags.length} ${i.flags.length === 1 ? "flag" : "flags"} raised` },
      { id: "t3", at: "2026-11-02T14:00:00Z", actorName: "Marcus Lee", action: "Approved step 1", detail: null },
    ] };
    if (seg[2] === "process-log") {
      const started = s.uploads[i.id];
      const n = started ? Math.min(PIPELINE.length, Math.floor((Date.now() - started) / 900) + 1) : PIPELINE.length;
      if (started && n >= PIPELINE.length && i.status === "processing") i.status = "pending_approval";
      return { status: 200, data: PIPELINE.slice(0, n).map((step, k) => ({ id: `${i.id}-s${k}`, at: new Date().toISOString(), step, status: k === 4 && i.flags.length ? "warn" : "ok", message: k === 4 && i.flags.length ? "Possible duplicate found" : "Done" })) };
    }
    if (seg[2] === "decision") {
      const d = (body as { decision: string }).decision;
      i.status = d === "approve" ? "approved" : "rejected";
      return { status: 200, data: i };
    }
    if (seg[2] === "process") return { status: 200, data: i };
    if (seg[2] === "lines") {
      const line = i.lines.find((l) => l.id === seg[3]);
      if (line) Object.assign(line, body);
      return { status: 200, data: line };
    }
  }
  if (path === "/approvals/inbox") return { status: 200, data: s.invoices.filter((i) => i.status === "pending_approval" || i.status === "blocked").slice(0, 12).map((i, k) => ({ ...summary(i), ageDays: 2 + k, flags: i.flags, whyYou: i.totalCents > 500_000 ? "Over 5,000.00 CAD — finance sign-off" : "You approve this vendor" })) };
  if (path === "/exceptions") return { status: 200, data: s.invoices.filter((i) => i.status === "blocked" || i.status === "needs_review").slice(0, 8).map((i) => ({ id: `ex-${i.id}`, invoice: summary(i), flags: i.flags, createdAt: "2026-11-15T10:00:00Z" })) };
  if (path === "/exceptions/historical") return { status: 200, data: [{ id: "h1", invoiceNumber: "INV-2311", vendorName: "Strait Telecom", resolution: "sent_to_approval", resolvedBy: "Priya Shah", resolvedAt: "2026-11-10T12:00:00Z", note: "PO confirmed by ops." }] };
  if (seg[0] === "exceptions" && seg[2] === "resolve") {
    const i = inv(seg[1]!.replace("ex-", ""));
    if (i) { i.status = (body as { action: string }).action === "reject" ? "rejected" : "pending_approval"; i.flags = []; }
    return { status: 200, data: {} };
  }
  if (path === "/inbox/import") return { status: 200, data: { imported: 3 } };
  if (path === "/inbox/other") return { status: 200, data: [{ id: "e1", from: "newsletter@fleetnews.com", subject: "November fleet digest", receivedAt: "2026-11-20T08:00:00Z", reason: "No invoice attachment" }] };
  if (path === "/payments") return { status: 200, data: s.payments };
  if (path === "/payments/ready") return { status: 200, data: s.invoices.filter((i) => i.status === "approved").map((i) => ({ ...summary(i), method: i.paymentMethod === "cheque" ? "cheque" : "eft" })) };
  if (path === "/payments/prepare" || path === "/payments/release") {
    const i = inv((body as { invoiceId: string }).invoiceId);
    if (!i) return { status: 404, error: "Invoice not found." };
    const existing = s.payments.find((p) => p.invoiceId === i.id);
    if (path === "/payments/prepare") {
      if (!existing) s.payments.unshift({ id: `p${Date.now()}`, invoiceId: i.id, invoiceNumber: i.invoiceNumber, vendorName: i.vendorName, amountCents: i.totalCents, currency: i.currency, method: i.paymentMethod === "cheque" ? "cheque" : "eft", status: "prepared", scheduledFor: i.dueDate });
    } else if (existing) existing.status = "released";
    i.status = "scheduled";
    return { status: 200, data: {} };
  }
  if (path === "/reconciliation") return { status: 200, data: recon() };
  if (path === "/reports/aging") return { status: 200, data: { currency: "CAD", buckets: [
    { label: "Current", amountCents: 18_420_050, count: 41 }, { label: "1–30 days", amountCents: 9_310_000, count: 22 },
    { label: "31–60 days", amountCents: 3_120_400, count: 8 }, { label: "61–90 days", amountCents: 880_000, count: 3 }, { label: "90+ days", amountCents: 215_000, count: 1 } ] } };
  if (path === "/reports/spend") return { status: 200, data: { currency: "CAD", rows: VENDORS.map((v, k) => ({ vendorName: v.name, amountCents: [12_400_000, 6_210_000, 4_800_500, 2_150_000, 990_000][k]! })) } };
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
  if (path === "/process-log") return { status: 200, data: s.invoices.slice(0, Number(q.get("limit") ?? 20)).map((i, k) => ({ id: `pl${k}`, at: `2026-11-21T${String(16 - (k % 10)).padStart(2, "0")}:0${k % 6}:00Z`, step: PIPELINE[k % PIPELINE.length]!, status: i.flags.length ? "warn" : "ok", message: `${i.invoiceNumber} · ${i.vendorName}`, invoiceId: i.id })) };
  if (path === "/users") return { status: 200, data: [ME] };
  if (path === "/admin/approval-rules") return { status: 200, data: s.rules };
  if (seg[0] === "admin" && seg[2]) { const r = s.rules.find((x) => x.id === seg[2]); if (r) Object.assign(r, body); return { status: 200, data: r }; }
  if (path.endsWith("eft-file") || path.endsWith("cheques")) return { status: 200, data: "" };
  return { status: 404, error: `No sample data for ${path}.` };
}

function recon(): T.Reconciliation {
  return { periodLabel: "November 2026", matchedCount: 212, unmatchedCount: 4, matchedCents: 31_204_550, unmatchedCents: 412_300, currency: "CAD", lastRunAt: "2026-11-21T06:00:00Z" };
}

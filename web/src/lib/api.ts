// The ONLY place the app talks to the network. Relative "/api" paths, cookies included.
// When VITE_USE_MOCKS === "true" requests are answered by src/lib/mock.ts instead.
import type * as T from "./types";

export const USE_MOCKS = import.meta.env["VITE_USE_MOCKS"] === "true";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function friendly(status: number, serverMsg: string | undefined): string {
  if (serverMsg) {
    if (status === 409) return `${serverMsg} Someone else changed this — refresh and try again.`;
    return serverMsg;
  }
  if (status === 409) return "Someone else changed this. Refresh and try again.";
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  if (status === 403) return "Your role can't see this.";
  if (status === 404) return "Not found.";
  return `Request failed (${status}).`;
}

interface Opts {
  method?: string;
  body?: unknown;
  form?: FormData;
  idempotent?: boolean;
}

async function raw(path: string, opts: Opts = {}): Promise<{ data: unknown; total: number | null }> {
  const method = opts.method ?? "GET";
  if (USE_MOCKS) {
    const { mockRequest } = await import("./mock");
    const r = await mockRequest(method, path, opts.body);
    if (r.status >= 400) throw new ApiError(r.status, friendly(r.status, r.error));
    return { data: r.data, total: r.total ?? null };
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  // New key per user intent: each call of a mutation = one click = one key.
  if (opts.idempotent) headers["Idempotency-Key"] = crypto.randomUUID();
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : null),
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : undefined;
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/login") && !path.startsWith("/me")) {
      window.location.assign("/login");
    }
    throw new ApiError(res.status, friendly(res.status, msg));
  }
  const tc = res.headers.get("X-Total-Count");
  return { data, total: tc ? Number(tc) : null };
}

async function get<R>(path: string): Promise<R> {
  return (await raw(path)).data as R;
}
async function list<R>(path: string): Promise<T.Paged<R>> {
  const r = await raw(path);
  const items = (r.data as R[]) ?? [];
  return { items, total: r.total ?? items.length };
}
async function post<R>(path: string, body?: unknown, idempotent = false): Promise<R> {
  return (await raw(path, { method: "POST", body, idempotent })).data as R;
}

function qs(p: Record<string, string | number | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
}

/** Trigger a browser download of a file endpoint. */
export function downloadUrl(path: string): string {
  return `/api${path}`;
}

export const api = {
  login: (email: string, password: string) => post<T.Me>("/login", { email, password }),
  logout: async () => {
    try {
      await post("/logout");
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
  },
  me: () => get<T.Me>("/me"),
  dashboard: () => get<T.Dashboard>("/dashboard"),

  invoices: (p: { status?: string | undefined; limit: number; offset: number }) =>
    list<T.InvoiceSummary>(`/invoices${qs(p)}`),
  invoiceCounts: () => get<T.InvoiceCounts>("/invoices/counts"),
  invoice: (id: string) => get<T.InvoiceDetail>(`/invoices/${id}`),
  invoiceTrail: (id: string) => get<T.TrailEntry[]>(`/invoices/${id}/trail`),
  invoiceProcessLog: (id: string) => get<T.ProcessStep[]>(`/invoices/${id}/process-log`),
  processInvoice: (id: string) => post(`/invoices/${id}/process`),
  decide: (id: string, decision: "approve" | "reject", comment?: string) =>
    post(`/invoices/${id}/decision`, { decision, comment }, true),
  codeLine: (id: string, lineId: string, body: { glAccount: string; costCenter: string }) =>
    raw(`/invoices/${id}/lines/${lineId}/coding`, { method: "PATCH", body }),
  upload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return (await raw("/invoices/upload", { method: "POST", form, body: USE_MOCKS ? { name: file.name } : undefined }))
      .data as T.InvoiceSummary;
  },

  approvalsInbox: () => get<T.InboxItem[]>("/approvals/inbox"),
  exceptions: () => get<T.ExceptionItem[]>("/exceptions"),
  historicalExceptions: () => get<T.HistoricalException[]>("/exceptions/historical"),
  resolveException: (id: string, action: "send_to_approval" | "reject", note: string) =>
    post(`/exceptions/${id}/resolve`, { action, note }, true),
  importInbox: () => post<{ imported: number }>("/inbox/import"),
  otherInbox: () => get<T.OtherInboxEmail[]>("/inbox/other"),

  payments: () => get<T.Payment[]>("/payments"),
  readyToPay: () => get<T.ReadyToPay[]>("/payments/ready"),
  preparePayment: (invoiceId: string) => post("/payments/prepare", { invoiceId }, true),
  releasePayment: (invoiceId: string) => post("/payments/release", { invoiceId }, true),

  reconciliation: () => get<T.Reconciliation>("/reconciliation"),
  runReconciliation: () => post<T.Reconciliation>("/reconciliation"),
  aging: () => get<T.AgingReport>("/reports/aging"),
  spend: () => get<T.SpendReport>("/reports/spend"),
  discounts: () => get<T.DiscountReport>("/reports/discounts"),

  vendors: () => get<T.Vendor[]>("/vendors"),
  vendor: (id: string) => get<T.VendorDetail>(`/vendors/${id}`),
  updateVendor: (id: string, body: Partial<T.Vendor>) => raw(`/vendors/${id}`, { method: "PATCH", body }),
  requestBankChange: (id: string, body: { institution: string; transit: string; account: string }) =>
    post(`/vendors/${id}/bank-change`, body, true),
  verifyBankChange: (id: string, body: { calledNumber: string; note: string }) =>
    post(`/vendors/${id}/bank-change/verify`, body, true),

  audit: () => get<T.AuditEntry[]>("/audit"),
  auditVerify: () => get<T.AuditVerify>("/audit/verify"),
  processLog: (limit: number) => get<T.ProcessStep[]>(`/process-log${qs({ limit })}`),
  users: () => get<T.AppUser[]>("/users"),
  approvalRules: () => get<T.ApprovalRule[]>("/admin/approval-rules"),
  updateApprovalRule: (id: string, body: Partial<T.ApprovalRule>) =>
    raw(`/admin/approval-rules/${id}`, { method: "PUT", body }),
};

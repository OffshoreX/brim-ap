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

// The server explains its own refusals as { error: "..." }; show that text as it is. Only a missing body gets a generic line.
const failure = (status: number, data: unknown): ApiError =>
  new ApiError(status, data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `Request failed (${status}).`);

type Page = { limit: number; offset: number };

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
    if (r.status >= 400) throw failure(r.status, { error: r.error });
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
    // 401 = no valid session cookie: send the user to the login page (but not while logging in or asking who we are).
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/login") && !path.startsWith("/me")) {
      window.location.assign("/login");
    }
    throw failure(res.status, data);
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
  // POST /api/login -> { user: { id, name, role } }. The cookie is set by the server; callers re-read /me for the full user.
  login: async (email: string, password: string) =>
    (await post<{ user: Pick<T.Me, "id" | "name" | "role"> }>("/login", { email, password })).user,
  // POST /api/logout -> { ok: true } and a Set-Cookie that clears the session. It always succeeds, even with no session.
  logout: () => post<{ ok: true }>("/logout"),
  // GET /api/me -> { user: <whole users row> }. The row has more columns (approval limit, manager...) than the app needs.
  me: async (): Promise<T.Me> => {
    const { user } = await get<{ user: T.Me }>("/me");
    return { id: user.id, name: user.name, email: user.email, title: user.title ?? null, role: user.role };
  },
  dashboard: () => get<T.Dashboard>("/dashboard"),

  // GET /api/invoices rows carry only vendorId: no vendor name, due date or flags. /api/vendors is closed to employees and
  // approvers, so each row's own invoice detail supplies them instead (every role may read the invoices it can list).
  // A failed lookup leaves nulls, never a broken page. 25 rows per page = 25 small calls; the real fix is for the list
  // endpoint to return these fields (server change, noted in the PR).
  invoices: async (p: { status?: string | undefined; limit: number; offset: number }): Promise<T.Paged<T.InvoiceRow>> => {
    const page = await list<T.InvoiceListItem>(`/invoices${qs(p)}`);
    const details = await Promise.allSettled(page.items.map((i) => get<T.InvoiceDetail>(`/invoices/${i.id}`)));
    const items = page.items.map((i, k): T.InvoiceRow => {
      const d = details[k];
      return d && d.status === "fulfilled"
        ? { ...i, vendorName: d.value.vendorName, dueDate: d.value.dueDate, flagCount: d.value.flags.length }
        : { ...i, vendorName: null, dueDate: null, flagCount: null };
    });
    return { items, total: page.total };
  },
  invoiceCounts: () => get<T.InvoiceCounts>("/invoices/counts"),
  invoice: (id: string | number) => get<T.InvoiceDetail>(`/invoices/${id}`),
  invoiceTrail: (id: string | number) => get<T.TrailEntry[]>(`/invoices/${id}/trail`),
  invoiceProcessLog: (id: string | number) => get<T.ProcessStep[]>(`/invoices/${id}/process-log`),
  processInvoice: (id: string | number) => post(`/invoices/${id}/process`),
  // The server wants "approved" | "rejected" (past tense) and ignores a client-supplied approver: the stored chain decides.
  // The route does not read Idempotency-Key (the stored chain and an atomic status check refuse a repeat with 409), but every
  // money-adjacent click sends a fresh key so the call is safe the day the server starts honouring it.
  decide: (id: string | number, decision: "approved" | "rejected", comment?: string) =>
    post<T.DecisionResult>(`/invoices/${id}/decision`, { decision, comment: comment ?? "" }, true),
  // Release works on a payment row (status "scheduled"), not on an invoice id.
  releaseScheduled: (paymentId: number) => post<T.ReleaseResult>("/payments/release", { paymentId }, true),
  // POST /api/invoices/upload (multipart, field "file") -> { results: [one per file] }. The request stays open until the file has
  // been through every pipeline step, so the invoice id is only known at the end; the page finds it earlier with newestInvoiceId.
  // A refused file is a 200 with results[0].error set, so that is turned into a thrown error here: callers see one failure path.
  upload: async (file: File): Promise<T.UploadFileResult & { invoiceId: number }> => {
    const form = new FormData();
    form.append("file", file);
    const r = (await raw("/invoices/upload", { method: "POST", form, idempotent: true, body: USE_MOCKS ? { name: file.name } : undefined }))
      .data as { results: T.UploadFileResult[] };
    const one = r.results[0];
    if (!one) throw new ApiError(500, "The server returned no result for this file.");
    if (one.invoiceId === null) throw new ApiError(400, one.error ?? "The file was not accepted.");
    return { ...one, invoiceId: one.invoiceId };
  },
  // Highest invoice id this user can see (the list is newest first). Taken before an upload, then polled, to spot the new row.
  newestInvoiceId: async () => (await list<T.InvoiceListItem>("/invoices?limit=1")).items[0]?.id ?? 0,

  // The five lists below are paged by the server (?limit=&offset=, total in X-Total-Count).
  approvalsInbox: (p: Page) => list<T.InboxItem>(`/approvals/inbox${qs(p)}`),
  // GET /api/exceptions rows carry no vendor name, due date or flag severity; each row's invoice detail supplies them
  // (same approach as invoices above). A failed lookup falls back to the row's own flags, shown as warnings.
  exceptions: async (p: Page): Promise<T.Paged<T.ExceptionRow>> => {
    const page = await list<T.ExceptionListItem>(`/exceptions${qs(p)}`);
    const details = await Promise.allSettled(page.items.map((x) => get<T.InvoiceDetail>(`/invoices/${x.id}`)));
    const items = page.items.map((x, k): T.ExceptionRow => {
      const d = details[k];
      const base = { id: x.id, invoiceNumber: x.invoiceNumber, vendorId: x.vendorId, totalCents: x.totalCents, currency: x.currency };
      return d && d.status === "fulfilled"
        ? { ...base, vendorName: d.value.vendorName, dueDate: d.value.dueDate, flags: d.value.flags }
        : { ...base, vendorName: null, dueDate: null, flags: x.flags.map((f) => ({ ...f, severity: "warning" as const })) };
    });
    return { items, total: page.total };
  },
  historicalExceptions: (p: Page) => list<T.HistoricalException>(`/exceptions/historical${qs(p)}`),
  // The server wants a note string (empty is fine) and refuses an invoice that is no longer in needs_review with 409.
  resolveException: (id: number, action: "send_to_approval" | "reject", note: string) =>
    post<T.ResolveResult>(`/exceptions/${id}/resolve`, { action, note }, true),
  // POST /api/inbox/import -> one row per email. New invoices land as "received"; they still need "Run processing".
  importInbox: async (): Promise<{ imported: number; skipped: number }> => {
    const rows = await post<T.ImportRow[]>("/inbox/import");
    return { imported: rows.reduce((n, r) => n + r.invoiceIds.length, 0), skipped: rows.filter((r) => r.skipped).length };
  },
  otherInbox: (p: Page) => list<T.OtherInboxEmail>(`/inbox/other${qs(p)}`),

  payments: (p: Page) => list<T.Payment>(`/payments${qs(p)}`),
  readyToPay: (p: Page) => list<T.ReadyToPay>(`/payments/ready${qs(p)}`),
  // No method sent: the server picks the vendor's preferred one (the same one readyToPay shows as suggestedMethod).
  preparePayment: (invoiceId: number) => post<T.PrepareResult>("/payments/prepare", { invoiceId }, true),

  reconciliation: () => get<T.Reconciliation>("/reconciliation"),
  runReconciliation: () => post<T.Reconciliation>("/reconciliation"),
  // GET /api/reports/aging -> [{ bucket: "0-30", invoices, totalCadCents }] (open invoices past due; CAD only).
  aging: async (): Promise<T.AgingReport> => {
    const rows = await get<{ bucket: string; invoices: number; totalCadCents: number }[]>("/reports/aging");
    return { currency: "CAD", buckets: rows.map((r) => ({ label: `${r.bucket} days past due`, amountCents: r.totalCadCents, count: r.invoices })) };
  },
  // GET /api/reports/spend?limit= -> [{ key: <vendor name>, invoices, totalCadCents }], biggest first.
  spend: async (limit = 8): Promise<T.SpendReport> => {
    const rows = await get<{ key: string; invoices: number; totalCadCents: number }[]>(`/reports/spend${qs({ limit })}`);
    return { currency: "CAD", rows: rows.map((r) => ({ vendorName: r.key, amountCents: r.totalCadCents })) };
  },
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

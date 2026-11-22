// Data hooks. Each comment names the endpoint it calls. All fetching is client-side (TanStack Query).
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SpendBy } from "@/lib/types";

// GET /api/me
export const useMe = () => useQuery({ queryKey: ["me"], queryFn: api.me, retry: false, staleTime: 60_000 });
// GET /api/dashboard
export const useDashboard = () => useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
// GET /api/invoices?status=&limit=&offset=
export const useInvoices = (p: { status?: string | undefined; limit: number; offset: number }) =>
  useQuery({ queryKey: ["invoices", p], queryFn: () => api.invoices(p), placeholderData: (prev) => prev });
// GET /api/invoices/counts
export const useInvoiceCounts = () => useQuery({ queryKey: ["invoice-counts"], queryFn: api.invoiceCounts });
// GET /api/invoices/:id
export const useInvoice = (id: string) => useQuery({ queryKey: ["invoice", id], queryFn: () => api.invoice(id) });
// GET /api/invoices/:id/trail
export const useInvoiceTrail = (id: string, enabled: boolean) =>
  useQuery({ queryKey: ["invoice", id, "trail"], queryFn: () => api.invoiceTrail(id), enabled });
// GET /api/invoices/:id/process-log (optionally polled)
export const useInvoiceProcessLog = (id: string | null, pollMs: number | false = false) =>
  useQuery({ queryKey: ["invoice", id, "process-log"], queryFn: () => api.invoiceProcessLog(id!), enabled: !!id, refetchInterval: pollMs, retry: false });
// The next six lists are paged by the server: pass { limit, offset }; the result is { items, total } (total = X-Total-Count).
// placeholderData keeps the old page on screen while the next one loads.
type Page = { limit: number; offset: number };
// GET /api/approvals/inbox
export const useApprovalsInbox = (p: Page) => useQuery({ queryKey: ["approvals", p], queryFn: () => api.approvalsInbox(p), placeholderData: (prev) => prev });
// GET /api/exceptions
export const useExceptions = (p: Page, enabled = true) => useQuery({ queryKey: ["exceptions", "open", p], queryFn: () => api.exceptions(p), enabled, placeholderData: (prev) => prev });
// GET /api/exceptions/historical
export const useHistoricalExceptions = (p: Page, enabled = true) =>
  useQuery({ queryKey: ["exceptions", "historical", p], queryFn: () => api.historicalExceptions(p), enabled, placeholderData: (prev) => prev });
// GET /api/inbox/other
export const useOtherInbox = (p: Page, enabled = true) => useQuery({ queryKey: ["inbox-other", p], queryFn: () => api.otherInbox(p), enabled, placeholderData: (prev) => prev });
// GET /api/payments
export const usePayments = (p: Page) => useQuery({ queryKey: ["payments", "all", p], queryFn: () => api.payments(p), placeholderData: (prev) => prev });
// GET /api/payments/ready
export const useReadyToPay = (p: Page, enabled = true) => useQuery({ queryKey: ["payments", "ready", p], queryFn: () => api.readyToPay(p), enabled, placeholderData: (prev) => prev });
// GET /api/reconciliation?category=&limit=&offset=
export const useReconciliation = (p: { category?: string | undefined; limit: number; offset: number }) =>
  useQuery({ queryKey: ["reconciliation", p], queryFn: () => api.reconciliation(p), placeholderData: (prev) => prev });
// GET /api/reports/aging
export const useAging = (enabled = true) => useQuery({ queryKey: ["reports", "aging"], queryFn: api.aging, enabled });
// GET /api/reports/spend?by=&limit=
export const useSpend = (by: SpendBy = "vendor", enabled = true) =>
  useQuery({ queryKey: ["reports", "spend", by], queryFn: () => api.spend(by), placeholderData: (prev) => prev, enabled });
// GET /api/reports/discounts
export const useDiscounts = () => useQuery({ queryKey: ["reports", "discounts"], queryFn: api.discounts });
// GET /api/vendors
export const useVendors = () => useQuery({ queryKey: ["vendors"], queryFn: api.vendors });
// GET /api/vendors/:id
export const useVendor = (id: string) => useQuery({ queryKey: ["vendor", id], queryFn: () => api.vendor(id) });
// GET /api/audit?limit=&offset=
export const useAudit = (p: { limit: number; offset: number }) =>
  useQuery({ queryKey: ["audit", p], queryFn: () => api.audit(p), placeholderData: (prev) => prev });
// GET /api/process-log?limit=
export const useProcessLog = (limit: number, enabled = true) =>
  useQuery({ queryKey: ["process-log", limit], queryFn: () => api.processLog(limit), enabled });
// GET /api/admin/approval-rules
export const useApprovalRules = () => useQuery({ queryKey: ["approval-rules"], queryFn: api.approvalRules });

/** Mutation helper: runs fn, then invalidates the listed query keys.
 *  Only one call runs at a time: isPending only turns true after React re-renders, so two clicks in the same tick would both
 *  get through. The ref flips at once; a second call while one is running does nothing (its promise never settles, so its
 *  .then toast never shows). The server is still the real guard: it answers a repeat with 409. */
export function useAction<A, R = unknown>(fn: (a: A) => Promise<R>, invalidate: string[][]) {
  const qc = useQueryClient();
  const busy = useRef(false);
  const m = useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of invalidate) void qc.invalidateQueries({ queryKey: k });
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const mutateAsync = (a: A): Promise<R> => {
    if (busy.current) return new Promise<R>(() => undefined);
    busy.current = true;
    return m.mutateAsync(a);
  };
  return { ...m, mutateAsync };
}

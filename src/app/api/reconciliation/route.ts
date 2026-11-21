import { handle, requireRole } from "@/server/authz";
import { parsePage } from "@/server/paging";
import { applyReconciliation, isCategory, reconciliationCsv, reconciliationReport } from "@/server/reconciliation";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["finance_manager", "controller_admin", "auditor"]);
    const q = new URL(request.url).searchParams;
    const category = q.get("category");
    if (category !== null && !isCategory(category)) return Response.json({ error: "unknown category" }, { status: 400 });
    const method = q.get("method");
    if (method !== null && !["EFT", "CHEQUE", "CARD"].includes(method)) return Response.json({ error: "method must be EFT, CHEQUE or CARD" }, { status: 400 });
    const format = q.get("format");
    if (format !== null && format !== "csv") return Response.json({ error: "format must be csv" }, { status: 400 });
    const filter = { category: category ?? undefined, method: method ?? undefined };
    // The export ignores limit/offset: it holds every matching row.
    if (format === "csv")
      return new Response(reconciliationCsv(filter), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="reconciliation.csv"' },
      });
    const page = parsePage(request);
    if (page instanceof Response) return page;
    const out = reconciliationReport(filter, page);
    return Response.json(out, { headers: { "X-Total-Count": String(out.total) } });
  });

// Saves each released payment's reconciliation_status; writes an audit row for every payment whose status changed.
export const POST = (request: Request) =>
  handle(() => {
    const user = requireRole(request, ["finance_manager", "controller_admin"]);
    return Response.json(applyReconciliation(user));
  });

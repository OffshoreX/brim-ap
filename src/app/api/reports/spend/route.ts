import { handle, requireRole } from "@/server/authz";
import { parsePage } from "@/server/paging";
import { REPORT_ROLES, reportResponse, SPEND_BY, spendReport, type SpendBy } from "@/server/reports";

// ?by=vendor|department|month (default vendor). The CSV is the whole list; JSON is paged.
export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, REPORT_ROLES);
    const q = new URL(request.url).searchParams;
    const by = (q.get("by") ?? "vendor") as SpendBy;
    if (!SPEND_BY.includes(by)) return Response.json({ error: "by must be vendor, department or month" }, { status: 400 });
    const page = parsePage(request);
    if (page instanceof Response) return page;
    const { rows, total } = spendReport(by, q.get("format") === "csv" ? null : page);
    return reportResponse(request, `spend-by-${by}`, rows, ["key", "invoices", "totalCadCents"], total);
  });

import { handle, requireRole } from "@/server/authz";
import { countInvoices, isInvoiceStatus, listInvoices } from "@/server/invoices";
import { parseInvoiceFilters } from "@/server/invoiceFilters";
import { pagedJson, parsePage } from "@/server/paging";

export const GET = (request: Request) =>
  handle(() => {
    const user = requireRole(request, ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"]);
    const page = parsePage(request);
    if (page instanceof Response) return page;
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    if (status !== undefined && !isInvoiceStatus(status)) return Response.json({ error: `Unknown status: ${status}` }, { status: 400 });
    const filters = parseInvoiceFilters(new URL(request.url).searchParams);
    if (typeof filters === "string") return Response.json({ error: filters }, { status: 400 });
    return pagedJson(listInvoices(user, page, status, filters), countInvoices(user, status, filters));
  });

import { handle, requireRole } from "@/server/authz";
import { countInvoices, isInvoiceStatus, listInvoices } from "@/server/invoices";
import { pagedJson, parsePage } from "@/server/paging";

export const GET = (request: Request) =>
  handle(() => {
    const user = requireRole(request, ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"]);
    const page = parsePage(request);
    if (page instanceof Response) return page;
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    if (status !== undefined && !isInvoiceStatus(status)) return Response.json({ error: `Unknown status: ${status}` }, { status: 400 });
    return pagedJson(listInvoices(user, page, status), countInvoices(user, status));
  });

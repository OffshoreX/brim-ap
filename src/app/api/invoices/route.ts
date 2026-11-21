import { handle, requireRole } from "@/server/authz";
import { countInvoices, listInvoices } from "@/server/invoices";
import { pagedJson, parsePage } from "@/server/paging";

export const GET = (request: Request) =>
  handle(() => {
    const user = requireRole(request, ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"]);
    const page = parsePage(request);
    if (page instanceof Response) return page;
    return pagedJson(listInvoices(user, page), countInvoices(user));
  });

import { handle, requireRole } from "@/server/authz";
import { pagedJson, parsePage } from "@/server/paging";
import { countPayments, listPayments } from "@/server/views";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin", "auditor"]);
    const page = parsePage(request);
    if (page instanceof Response) return page;
    return pagedJson(listPayments(page), countPayments());
  });

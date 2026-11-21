import { handle, requireRole } from "@/server/authz";
import { countExceptions, listExceptions } from "@/server/exceptions";
import { pagedJson, parsePage } from "@/server/paging";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin"]);
    const page = parsePage(request);
    if (page instanceof Response) return page;
    return pagedJson(listExceptions(page), countExceptions());
  });

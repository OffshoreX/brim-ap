import { handle, requireRole } from "@/server/authz";
import { pagedJson, parsePage } from "@/server/paging";
import { countReadyToPay, readyToPay } from "@/server/views";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin"]);
    const page = parsePage(request);
    if (page instanceof Response) return page;
    return pagedJson(readyToPay(page), countReadyToPay());
  });

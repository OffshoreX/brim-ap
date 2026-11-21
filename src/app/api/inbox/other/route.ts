import { handle, requireRole } from "@/server/authz";
import { countOtherMail, listOtherMail } from "@/server/inbox";
import { pagedJson, parsePage } from "@/server/paging";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "controller_admin", "auditor"]);
    const page = parsePage(request);
    if (page instanceof Response) return page;
    return pagedJson(listOtherMail(page), countOtherMail());
  });

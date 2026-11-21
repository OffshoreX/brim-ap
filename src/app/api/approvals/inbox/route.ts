import { handle, requireRole } from "@/server/authz";
import { pagedJson, parsePage } from "@/server/paging";
import { approvalInbox, countApprovalInbox } from "@/server/views";

export const GET = (request: Request) =>
  handle(() => {
    const user = requireRole(request, ["approver", "finance_manager", "controller_admin"]);
    const page = parsePage(request);
    if (page instanceof Response) return page;
    return pagedJson(approvalInbox(user, page), countApprovalInbox(user));
  });

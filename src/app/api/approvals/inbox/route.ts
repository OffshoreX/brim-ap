import { handle, requireRole } from "@/server/authz";
import { approvalInbox } from "@/server/views";

export const GET = (request: Request) =>
  handle(() => {
    const user = requireRole(request, ["approver", "finance_manager", "controller_admin"]);
    return Response.json(approvalInbox(user));
  });

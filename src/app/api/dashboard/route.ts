import { handle, requireRole } from "@/server/authz";
import { dashboard } from "@/server/views";

export const GET = (request: Request) =>
  handle(() => {
    const user = requireRole(request, ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"]);
    return Response.json(dashboard(user));
  });

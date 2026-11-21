import { handle, requireRole } from "@/server/authz";
import { listPayments } from "@/server/views";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin", "auditor"]);
    return Response.json(listPayments());
  });

import { handle, requireRole } from "@/server/authz";
import { listExceptions } from "@/server/exceptions";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin"]);
    return Response.json(listExceptions());
  });

import { handle, requireRole } from "@/server/authz";
import { listVendors } from "@/server/vendors";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin", "auditor"]);
    return Response.json(listVendors());
  });

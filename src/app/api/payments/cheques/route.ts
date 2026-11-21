import { handle, requireRole } from "@/server/authz";
import { chequeList } from "@/server/payments";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["finance_manager", "controller_admin", "auditor"]);
    return Response.json({ cheques: chequeList() });
  });

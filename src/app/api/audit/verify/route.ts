import { verifyAuditChain } from "@/server/audit";
import { handle, requireRole } from "@/server/authz";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["auditor", "controller_admin"]);
    return Response.json(verifyAuditChain());
  });

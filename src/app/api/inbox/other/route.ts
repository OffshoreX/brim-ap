import { handle, requireRole } from "@/server/authz";
import { listOtherMail } from "@/server/inbox";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "controller_admin", "auditor"]);
    return Response.json(listOtherMail());
  });

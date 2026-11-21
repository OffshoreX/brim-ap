import { handle, requireRole } from "@/server/authz";
import { importInbox } from "@/server/inbox";

export const POST = (request: Request) =>
  handle(() => {
    const user = requireRole(request, ["ap_clerk", "controller_admin"]);
    return Response.json(importInbox(user));
  });

import { ROLES } from "@/contracts";
import { handle, requireRole } from "@/server/authz";

export const GET = (request: Request) =>
  handle(() => Response.json({ user: requireRole(request, ROLES) }));

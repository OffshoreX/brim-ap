import { handle, requireRole } from "@/server/authz";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["controller_admin"]);
    return Response.json({ ok: true });
  });

import { handle, requireRole } from "@/server/authz";
import { listRules } from "@/server/approvalRules";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["controller_admin"]);
    const r = listRules();
    return Response.json(r.body, { status: r.status });
  });

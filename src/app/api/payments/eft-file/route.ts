import { handle, requireRole } from "@/server/authz";
import { eftFileCsv } from "@/server/payments";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["finance_manager", "controller_admin", "auditor"]);
    return new Response(eftFileCsv(), { headers: { "content-type": "text/csv; charset=utf-8" } });
  });

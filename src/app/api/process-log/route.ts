import { handle, requireRole } from "@/server/authz";
import { MAX_LIMIT } from "@/server/paging";
import { recentProcessLog } from "@/server/processLog";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin", "auditor"]);
    const raw = new URL(request.url).searchParams.get("limit");
    const limit = raw === null ? 50 : Number(raw);
    if (raw !== null && (raw.trim() === "" || !Number.isInteger(limit) || limit < 1)) return Response.json({ error: "limit must be a whole number from 1" }, { status: 400 });
    return Response.json(recentProcessLog(Math.min(limit, MAX_LIMIT)));
  });

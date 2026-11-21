import { handle, requireRole } from "@/server/authz";
import { listHistoricalAnomalies } from "@/server/replayHistory";
import { parsePage } from "@/server/paging";

// Read-only flagged history (T45). The auditor may read it; nobody can change anything through it.
export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin", "auditor"]);
    const page = parsePage(request);
    if (page instanceof Response) return page;
    const { items, total } = listHistoricalAnomalies(page);
    return Response.json(items, { headers: { "X-Total-Count": String(total) } });
  });

import { handle, requireRole } from "@/server/authz";
import { pagedJson, parsePage } from "@/server/paging";
import { auditLog, countAudit } from "@/server/views";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["auditor", "controller_admin", "finance_manager"]);
    const q = new URL(request.url).searchParams;
    const actor = q.get("actor");
    if (actor !== null && !Number.isInteger(Number(actor))) return Response.json({ error: "actor must be a whole number" }, { status: 400 });
    const page = parsePage(request);
    if (page instanceof Response) return page;
    const filter = { entity: q.get("entity") || undefined, actor: actor === null ? undefined : Number(actor), from: q.get("from") || undefined, to: q.get("to") || undefined };
    return pagedJson(auditLog({ ...filter, ...page }), countAudit(filter));
  });

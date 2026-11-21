import { handle, requireRole } from "@/server/authz";
import { auditLog } from "@/server/views";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["auditor", "controller_admin", "finance_manager"]);
    const q = new URL(request.url).searchParams;
    const actor = q.get("actor");
    const limit = q.get("limit");
    if ((actor !== null && !Number.isInteger(Number(actor))) || (limit !== null && !(Number.isInteger(Number(limit)) && Number(limit) > 0)))
      return Response.json({ error: "actor and limit must be whole numbers" }, { status: 400 });
    return Response.json(
      auditLog({
        entity: q.get("entity") || undefined,
        actor: actor === null ? undefined : Number(actor),
        from: q.get("from") || undefined,
        to: q.get("to") || undefined,
        limit: limit === null ? undefined : Number(limit),
      })
    );
  });

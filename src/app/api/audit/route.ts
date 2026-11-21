import { handle, requireRole } from "@/server/authz";
import { pagedJson, parsePage } from "@/server/paging";
import { auditCsvStream, auditLog, countAudit } from "@/server/views";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["auditor", "controller_admin", "finance_manager"]);
    const q = new URL(request.url).searchParams;
    const actor = q.get("actor");
    if (actor !== null && !Number.isInteger(Number(actor))) return Response.json({ error: "actor must be a whole number" }, { status: 400 });
    const format = q.get("format");
    if (format !== null && format !== "csv") return Response.json({ error: "format must be csv" }, { status: 400 });
    const page = parsePage(request);
    if (page instanceof Response) return page;
    const filter = { entity: q.get("entity") || undefined, actor: actor === null ? undefined : Number(actor), from: q.get("from") || undefined, to: q.get("to") || undefined };
    // The export ignores limit/offset: it streams every matching row.
    if (format === "csv")
      return new Response(auditCsvStream(filter), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="audit-log.csv"' },
      });
    return pagedJson(auditLog({ ...filter, ...page }), countAudit(filter));
  });

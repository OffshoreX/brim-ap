import { handle, requireRole } from "@/server/authz";
import { CodingError, setLineCoding, type CodingPatch } from "@/server/lineCoding";

export const PATCH = (request: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["ap_clerk", "finance_manager", "controller_admin"]);
    const p = await params;
    const invoiceId = Number(p.id);
    const lineId = Number(p.lineId);
    const body = await request.json().catch(() => null);
    if (!Number.isInteger(invoiceId) || !Number.isInteger(lineId)) return Response.json({ error: "invalid id" }, { status: 400 });
    if (!body || typeof body !== "object") return Response.json({ error: "body must be an object" }, { status: 400 });
    const patch: CodingPatch = {};
    if (body.glAccount !== undefined) { if (typeof body.glAccount !== "string") return Response.json({ error: "glAccount must be a string" }, { status: 400 }); patch.glAccount = body.glAccount; }
    if (body.taxCode !== undefined) { if (typeof body.taxCode !== "string") return Response.json({ error: "taxCode must be a string" }, { status: 400 }); patch.taxCode = body.taxCode; }
    if (body.departmentId !== undefined) { if (!Number.isInteger(body.departmentId)) return Response.json({ error: "departmentId must be an integer" }, { status: 400 }); patch.departmentId = body.departmentId; }
    try {
      return Response.json(setLineCoding(user, invoiceId, lineId, patch));
    } catch (e) {
      if (e instanceof CodingError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

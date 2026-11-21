import { handle, requireRole } from "@/server/authz";
import { invoiceTrail, ViewError } from "@/server/views";

export const GET = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin", "auditor"]);
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    try {
      return Response.json(invoiceTrail(id));
    } catch (e) {
      if (e instanceof ViewError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

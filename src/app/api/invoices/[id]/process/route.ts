import { handle, requireRole } from "@/server/authz";
import { PipelineError, processInvoice } from "@/server/pipeline";

export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["ap_clerk", "controller_admin"]);
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    try {
      return Response.json(await processInvoice(id, user.id));
    } catch (e) {
      if (e instanceof PipelineError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

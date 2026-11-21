import { handle, requireRole } from "@/server/authz";
import { ExceptionError, resolveException } from "@/server/exceptions";

export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["ap_clerk", "finance_manager", "controller_admin"]);
    const id = Number((await params).id);
    const body = await request.json().catch(() => null);
    const action = body?.action;
    const note = body?.note;
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    if (action !== "send_to_approval" && action !== "reject")
      return Response.json({ error: "action must be send_to_approval or reject" }, { status: 400 });
    if (typeof note !== "string") return Response.json({ error: "note must be a string" }, { status: 400 });
    try {
      return Response.json(resolveException(user, id, action, note));
    } catch (e) {
      if (e instanceof ExceptionError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

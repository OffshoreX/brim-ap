import { handle, requireRole } from "@/server/authz";
import { requestBankChange, VendorError } from "@/server/vendors";

export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["ap_clerk", "finance_manager", "controller_admin"]);
    const id = Number((await params).id);
    const body = await request.json().catch(() => null);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    try {
      return Response.json(requestBankChange(user, id, body ?? {}), { status: 201 });
    } catch (e) {
      if (e instanceof VendorError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

import { handle, requireRole } from "@/server/authz";
import { invoiceProcessLog } from "@/server/processLog";
import { ViewError } from "@/server/views";

// Same visibility as the invoice: every role may ask, and visibleSql hides what the role may not see.
export const GET = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"]);
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    try {
      return Response.json(invoiceProcessLog(user, id));
    } catch (e) {
      if (e instanceof ViewError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

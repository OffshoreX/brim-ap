import { handle, requireRole } from "@/server/authz";
import { readJson } from "@/server/body";
import { ApprovalError, decideInvoice } from "@/server/approvals";

export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["approver", "finance_manager", "controller_admin"]);
    const id = Number((await params).id);
    const body = await readJson(request);
    const decision = body?.decision;
    const comment = body?.comment ?? "";
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    if (decision !== "approved" && decision !== "rejected")
      return Response.json({ error: "decision must be approved or rejected" }, { status: 400 });
    if (typeof comment !== "string") return Response.json({ error: "comment must be a string" }, { status: 400 });
    try {
      return Response.json(decideInvoice(user, id, decision, comment));
    } catch (e) {
      if (e instanceof ApprovalError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

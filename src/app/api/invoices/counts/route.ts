import { handle, requireRole } from "@/server/authz";
import { invoiceCounts } from "@/server/invoices";

export const GET = (request: Request) =>
  handle(() => {
    const user = requireRole(request, ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"]);
    return Response.json(invoiceCounts(user));
  });

import { handle, requireRole } from "@/server/authz";
import { createRule, listRules, type RuleResult } from "@/server/approvalRules";

const send = (r: RuleResult) => Response.json(r.body, { status: r.status });

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["controller_admin"]);
    return send(listRules());
  });

export const POST = (request: Request) =>
  handle(async () => {
    const user = requireRole(request, ["controller_admin"]);
    return send(createRule(user.id, await request.json().catch(() => null)));
  });

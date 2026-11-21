import { handle, requireRole } from "@/server/authz";
import { deleteRule, updateRule, type RuleResult } from "@/server/approvalRules";

const send = (r: RuleResult) => Response.json(r.body, { status: r.status });
type Ctx = { params: Promise<{ id: string }> };
const bad = () => Response.json({ error: "id must be an integer" }, { status: 400 });

export const PUT = (request: Request, ctx: Ctx) =>
  handle(async () => {
    const user = requireRole(request, ["controller_admin"]);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return bad();
    return send(updateRule(user.id, id, await request.json().catch(() => null)));
  });

export const DELETE = (request: Request, ctx: Ctx) =>
  handle(async () => {
    const user = requireRole(request, ["controller_admin"]);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return bad();
    return send(deleteRule(user.id, id));
  });

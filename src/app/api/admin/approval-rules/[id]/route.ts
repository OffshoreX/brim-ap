import { handle, requireRole } from "@/server/authz";
import { readJson } from "@/server/body";
import { updateRule } from "@/server/approvalRules";

export const PUT = (request: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["controller_admin"]);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "id must be an integer" }, { status: 400 });
    const r = updateRule(user.id, user.role, id, await readJson(request));
    return Response.json(r.body, { status: r.status });
  });

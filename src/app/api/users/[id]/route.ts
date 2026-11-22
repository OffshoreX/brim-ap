import { handle, requireRole } from "@/server/authz";
import { readJson } from "@/server/body";
import { updateUser, UserError } from "@/server/users";

// Only the controller edits users. The guards (self-edit, last controller, loops) are in updateUser.
export const PATCH = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const actor = requireRole(request, ["controller_admin"]);
    const id = Number((await params).id);
    const body = await readJson(request);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "body must be an object" }, { status: 400 });
    try {
      return Response.json(updateUser(actor, id, body));
    } catch (e) {
      if (e instanceof UserError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

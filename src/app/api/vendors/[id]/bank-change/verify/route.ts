import { handle, requireRole } from "@/server/authz";
import { readJson } from "@/server/body";
import { verifyBankChange, VendorError } from "@/server/vendors";

// Only these roles may confirm a callback; the "not the requester" rule is in verifyBankChange.
export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["finance_manager", "controller_admin"]);
    const id = Number((await params).id);
    const body = await readJson(request);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    if (typeof body?.verified !== "boolean") return Response.json({ error: "verified must be true or false" }, { status: 400 });
    try {
      return Response.json(verifyBankChange(user, id, body.verified));
    } catch (e) {
      if (e instanceof VendorError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

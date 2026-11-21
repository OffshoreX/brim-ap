import { handle, requireRole } from "@/server/authz";
import { getVendor, updateVendor, VendorError } from "@/server/vendors";

type Ctx = { params: Promise<{ id: string }> };
const fail = (e: unknown) => {
  if (e instanceof VendorError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

export const GET = (request: Request, { params }: Ctx) =>
  handle(async () => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin", "auditor"]);
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    try { return Response.json(getVendor(id)); } catch (e) { return fail(e); }
  });

// Auditor is read-only. Bank fields are rejected inside updateVendor.
export const PATCH = (request: Request, { params }: Ctx) =>
  handle(async () => {
    const user = requireRole(request, ["ap_clerk", "controller_admin"]);
    const id = Number((await params).id);
    const body = await request.json().catch(() => null);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "body must be an object" }, { status: 400 });
    try { return Response.json(updateVendor(user, id, body)); } catch (e) { return fail(e); }
  });

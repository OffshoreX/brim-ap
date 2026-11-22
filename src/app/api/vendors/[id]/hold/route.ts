import { handle, requireRole } from "@/server/authz";
import { IdempotencyError } from "@/server/idempotency";
import { holdVendor } from "@/server/vendorOnboarding";
import { VendorError } from "@/server/vendors";

// A hold stops payment to the vendor at once; the reason is required and goes into the audit row.
export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["finance_manager", "controller_admin"]);
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    const body = await request.json().catch(() => null);
    try {
      return Response.json(holdVendor(user, id, body?.reason, request.headers.get("idempotency-key")));
    } catch (e) {
      if (e instanceof VendorError || e instanceof IdempotencyError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

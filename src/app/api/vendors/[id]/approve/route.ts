import { handle, requireRole } from "@/server/authz";
import { IdempotencyError } from "@/server/idempotency";
import { approveVendor } from "@/server/vendorOnboarding";
import { VendorError } from "@/server/vendors";

// Only finance_manager and controller_admin approve; the "creator cannot approve" rule is in approveVendor.
export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["finance_manager", "controller_admin"]);
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });

    try {
      return Response.json(approveVendor(user, id, request.headers.get("idempotency-key")));
    } catch (e) {
      if (e instanceof VendorError || e instanceof IdempotencyError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

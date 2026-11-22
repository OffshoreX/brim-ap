import { handle, requireRole } from "@/server/authz";
import { IdempotencyError } from "@/server/idempotency";
import { releaseHold } from "@/server/vendorOnboarding";
import { VendorError } from "@/server/vendors";

// Same roles as hold: lifting a hold puts the vendor back in use, so it is a finance decision.
export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = requireRole(request, ["finance_manager", "controller_admin"]);
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "invalid id" }, { status: 400 });

    try {
      return Response.json(releaseHold(user, id, request.headers.get("idempotency-key")));
    } catch (e) {
      if (e instanceof VendorError || e instanceof IdempotencyError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

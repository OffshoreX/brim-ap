import { handle, requireRole } from "@/server/authz";
import { readJson } from "@/server/body";
import { IdempotencyError } from "@/server/idempotency";
import { createVendor } from "@/server/vendorOnboarding";
import { listVendors, VendorError } from "@/server/vendors";

export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, ["ap_clerk", "finance_manager", "controller_admin", "auditor"]);
    return Response.json(listVendors());
  });

// Creates the vendor as pending_review with no bank details. Field checks are in createVendor.
export const POST = (request: Request) =>
  handle(async () => {
    const user = requireRole(request, ["ap_clerk", "finance_manager", "controller_admin"]);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "body must be an object" }, { status: 400 });
    try {
      return Response.json(createVendor(user, body, request.headers.get("idempotency-key")), { status: 201 });
    } catch (e) {
      if (e instanceof VendorError || e instanceof IdempotencyError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

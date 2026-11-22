import { handle, requireRole } from "@/server/authz";
import { readJson } from "@/server/body";
import { IdempotencyError } from "@/server/idempotency";
import { PaymentError, releasePayment } from "@/server/payments";
import { rateLimit } from "@/server/security";

export const POST = (request: Request) =>
  handle(async () => {
    // Clerks and approvers never get past here; canRelease then checks size and separation of duties.
    const user = requireRole(request, ["finance_manager", "controller_admin"]);
    rateLimit("release", user.id);
    const body = await readJson(request);
    const paymentId = body?.paymentId;
    if (!Number.isInteger(paymentId)) return Response.json({ error: "paymentId must be an integer" }, { status: 400 });
    try {
      return Response.json(releasePayment(user, paymentId, undefined, request.headers.get("idempotency-key")));
    } catch (e) {
      if (e instanceof PaymentError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof IdempotencyError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

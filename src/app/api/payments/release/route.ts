import { handle, requireRole } from "@/server/authz";
import { PaymentError, releasePayment } from "@/server/payments";

export const POST = (request: Request) =>
  handle(async () => {
    // Clerks and approvers never get past here; canRelease then checks size and separation of duties.
    const user = requireRole(request, ["finance_manager", "controller_admin"]);
    const body = await request.json().catch(() => null);
    const paymentId = body?.paymentId;
    if (!Number.isInteger(paymentId)) return Response.json({ error: "paymentId must be an integer" }, { status: 400 });
    try {
      return Response.json(releasePayment(user, paymentId));
    } catch (e) {
      if (e instanceof PaymentError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

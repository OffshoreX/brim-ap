import { handle, requireRole } from "@/server/authz";
import { PaymentError, releasePayment } from "@/server/payments";

export const POST = (request: Request) =>
  handle(async () => {
    const user = requireRole(request, ["finance_manager", "controller_admin"]);
    const body = await request.json().catch(() => null);
    const invoiceId = body?.invoiceId;
    if (!Number.isInteger(invoiceId)) return Response.json({ error: "invoiceId must be an integer" }, { status: 400 });
    try {
      return Response.json(releasePayment(user, invoiceId));
    } catch (e) {
      if (e instanceof PaymentError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

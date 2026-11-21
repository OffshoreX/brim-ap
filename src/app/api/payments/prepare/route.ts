import { handle, requireRole } from "@/server/authz";
import { IdempotencyError } from "@/server/idempotency";
import { METHODS, PaymentError, preparePayment, type Method } from "@/server/payments";

export const POST = (request: Request) =>
  handle(async () => {
    const user = requireRole(request, ["ap_clerk", "finance_manager", "controller_admin"]);
    const body = await request.json().catch(() => null);
    const { invoiceId, method, scheduledDate } = body ?? {};
    if (!Number.isInteger(invoiceId)) return Response.json({ error: "invoiceId must be an integer" }, { status: 400 });
    if (method !== undefined && !METHODS.includes(method)) return Response.json({ error: "method must be EFT, CHEQUE or CARD" }, { status: 400 });
    if (scheduledDate !== undefined && !(typeof scheduledDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)))
      return Response.json({ error: "scheduledDate must be YYYY-MM-DD" }, { status: 400 });
    try {
      return Response.json(preparePayment(user, { invoiceId, method: method as Method | undefined, scheduledDate }, request.headers.get("idempotency-key")));
    } catch (e) {
      if (e instanceof PaymentError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof IdempotencyError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });

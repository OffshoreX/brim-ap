import { handle, requireRole } from "@/server/authz";
import { AS_OF } from "@/server/replayHistory";
import { agingReport, REPORT_ROLES, reportResponse } from "@/server/reports";

// ?asOf=yyyy-mm-dd overrides the dataset's as-of date.
export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, REPORT_ROLES);
    const asOf = new URL(request.url).searchParams.get("asOf") ?? AS_OF;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(asOf))) return Response.json({ error: "asOf must be yyyy-mm-dd" }, { status: 400 });
    return reportResponse(request, "aging", agingReport(asOf), ["bucket", "invoices", "totalCadCents"]);
  });

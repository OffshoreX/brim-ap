import { handle, requireRole } from "@/server/authz";
import { discountsReport, REPORT_ROLES, reportResponse } from "@/server/reports";

// One row per vendor with early-pay terms (a handful), so no paging.
export const GET = (request: Request) =>
  handle(() => {
    requireRole(request, REPORT_ROLES);
    return reportResponse(request, "discounts", discountsReport(), ["vendor", "terms", "takenPayments", "takenCadCents", "missedPayments", "missedCadCents"]);
  });

// Who may call what. One row per route + method. A new route.ts with no row here fails the matrix test.
// "public" = no session needed. Otherwise the list is every role that must NOT get 401/403.
import type { Role } from "@/contracts";

export const ROLES: Role[] = ["employee", "approver", "ap_clerk", "finance_manager", "controller_admin", "auditor"];

const ALL = ROLES;
const CLERK_UP = ["ap_clerk", "finance_manager", "controller_admin"] as const;
const APPROVERS = ["approver", "finance_manager", "controller_admin"] as const;

const REPORTS = ["finance_manager", "controller_admin", "auditor"] as const;

type Access = "public" | readonly Role[];

//  route (folder under src/app/api)     method   allowed roles
export const MATRIX: [string, string, Access][] = [
  ["login",                              "POST",  "public"],
  ["users",                              "GET",   "public"], // demo login dropdown, fake users only
  ["me",                                 "GET",   ALL],
  ["dashboard",                          "GET",   ALL],
  ["invoices",                           "GET",   ALL],
  ["invoices/[id]",                      "GET",   ALL],
  ["invoices/[id]/trail",                "GET",   ["ap_clerk", "finance_manager", "controller_admin", "auditor"]],
  ["invoices/[id]/decision",             "POST",  APPROVERS],
  ["invoices/[id]/lines/[lineId]/coding", "PATCH", CLERK_UP],
  ["invoices/[id]/process",              "POST",  ["ap_clerk", "controller_admin"]],
  ["invoices/upload",                    "POST",  ["employee", "ap_clerk", "controller_admin"]],
  ["approvals/inbox",                    "GET",   APPROVERS],
  ["exceptions",                         "GET",   CLERK_UP],
  ["exceptions/[id]/resolve",            "POST",  CLERK_UP],
  ["exceptions/historical",              "GET",   ["ap_clerk", "finance_manager", "controller_admin", "auditor"]],
  ["vendors",                            "GET",   ["ap_clerk", "finance_manager", "controller_admin", "auditor"]],
  ["vendors/[id]",                       "GET",   ["ap_clerk", "finance_manager", "controller_admin", "auditor"]],
  ["vendors/[id]",                       "PATCH", ["ap_clerk", "controller_admin"]],
  ["vendors/[id]/bank-change",           "POST",  CLERK_UP],
  ["vendors/[id]/bank-change/verify",    "POST",  ["finance_manager", "controller_admin"]],
  ["payments",                           "GET",   ["ap_clerk", "finance_manager", "controller_admin", "auditor"]],
  ["payments/prepare",                   "POST",  CLERK_UP],
  ["payments/release",                   "POST",  ["finance_manager", "controller_admin"]],
  ["payments/cheques",                   "GET",   ["finance_manager", "controller_admin", "auditor"]],
  ["payments/eft-file",                  "GET",   ["finance_manager", "controller_admin", "auditor"]],
  ["inbox/import",                       "POST",  ["ap_clerk", "controller_admin"]],
  ["inbox/other",                        "GET",   ["ap_clerk", "controller_admin", "auditor"]],
  ["reports/aging",                      "GET",   REPORTS],
  ["reports/spend",                      "GET",   REPORTS],
  ["reports/discounts",                  "GET",   REPORTS],
  ["audit",                              "GET",   ["auditor", "controller_admin", "finance_manager"]],
  ["admin/ping",                         "GET",   ["controller_admin"]],
  ["admin/approval-rules",               "GET",   ["controller_admin"]],
  ["admin/approval-rules/[id]",          "PUT",   ["controller_admin"]],
];

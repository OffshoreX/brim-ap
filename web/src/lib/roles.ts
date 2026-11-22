// UI-only role gating: hides what a role can never use.
// The server is the real enforcer — never rely on this for security.
import type { Role } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee",
  ap_clerk: "AP clerk",
  approver: "Approver",
  finance_manager: "Finance manager",
  controller_admin: "Controller",
  auditor: "Auditor",
};

const R = (...r: Role[]) => r;
export const CAN = {
  upload: R("employee", "ap_clerk", "controller_admin"),
  trail: R("ap_clerk", "finance_manager", "controller_admin", "auditor"),
  process: R("ap_clerk", "controller_admin"),
  decide: R("approver", "finance_manager", "controller_admin"),
  code: R("ap_clerk", "finance_manager", "controller_admin"),
  approvals: R("approver", "finance_manager", "controller_admin"),
  exceptions: R("ap_clerk", "finance_manager", "controller_admin"),
  exceptionsHistory: R("ap_clerk", "finance_manager", "controller_admin", "auditor"),
  importInbox: R("ap_clerk", "controller_admin"),
  payments: R("ap_clerk", "finance_manager", "controller_admin", "auditor"),
  prepare: R("ap_clerk", "finance_manager", "controller_admin"),
  release: R("finance_manager", "controller_admin"),
  downloads: R("finance_manager", "controller_admin", "auditor"),
  reconciliation: R("finance_manager", "controller_admin", "auditor"),
  vendors: R("ap_clerk", "finance_manager", "controller_admin", "auditor"),
  bankChange: R("ap_clerk", "finance_manager", "controller_admin"),
  bankVerify: R("finance_manager", "controller_admin"),
  audit: R("auditor", "controller_admin", "finance_manager"),
  auditVerify: R("auditor", "controller_admin"),
  activity: R("ap_clerk", "finance_manager", "controller_admin", "auditor"),
  admin: R("controller_admin"),
} satisfies Record<string, Role[]>;

export type Capability = keyof typeof CAN;
export function can(role: Role | undefined, cap: Capability): boolean {
  return !!role && (CAN[cap] as Role[]).includes(role);
}

import type { ReleasePayment, ReleaseResult, ReleaseUser } from "./types";

// Only these roles may release money; approvers approve invoices but never release payments.
const RELEASE_ROLES = ["finance_manager", "controller_admin"];

export function canRelease(user: ReleaseUser, payment: ReleasePayment): ReleaseResult {
  if (!RELEASE_ROLES.includes(user.role)) {
    return { allowed: false, reason: `Role ${user.role} cannot release payments` };
  }
  if (!Number.isInteger(payment.amountCents) || payment.amountCents <= 0) {
    return { allowed: false, reason: "Payment amount must be a positive whole number of cents" };
  }
  if (payment.amountCents > user.releaseLimitCents) {
    return { allowed: false, reason: "Amount exceeds your release limit" };
  }
  return { allowed: true };
}

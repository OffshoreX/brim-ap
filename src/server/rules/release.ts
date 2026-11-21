import { discountCentsFor, parseEarlyPayTerms } from "./paymentTerms";
import type { ReleasePayment, ReleaseResult, ReleaseTier, ReleaseUser } from "./types";

// Roles that may prepare a payment (P09: AP clerks prepare). Releasing is a separate, stricter check.
export const PREPARE_ROLES = ["ap_clerk", "finance_manager", "controller_admin"] as const;
// Never release, whatever the tier table says (P09, P11): a bad table row cannot open this door.
const NEVER_RELEASE = ["ap_clerk", "approver"];

// Limits come in as `tiers` (from approval policy P09/P10), so no amount is written in this file.
export function canRelease(user: ReleaseUser, payment: ReleasePayment, tiers: readonly ReleaseTier[]): ReleaseResult {
  if (NEVER_RELEASE.includes(user.role)) return { allowed: false, reason: `Role ${user.role} cannot release payments`, code: "role" };
  if (!Number.isInteger(payment.amountCadCents) || payment.amountCadCents <= 0) {
    return { allowed: false, reason: "Payment amount must be a positive whole number of cents", code: "amount" };
  }
  const tier = tiers.find((t) => t.upToCents === null || payment.amountCadCents <= t.upToCents);
  if (!tier) return { allowed: false, reason: "No release tier covers this amount", code: "no_tier" };
  if (!tier.roles.includes(user.role)) return { allowed: false, reason: `Role ${user.role} cannot release a payment of this size`, code: "size" };
  // P11: separation of duties.
  if (payment.approverIds.includes(user.id)) return { allowed: false, reason: "You approved this invoice, so you cannot release its payment", code: "approver" };
  if (payment.preparedBy === user.id) return { allowed: false, reason: "You prepared this payment, so you cannot release it", code: "preparer" };
  return { allowed: true };
}

// Kept as the one call payments.ts makes; parsing and window maths live in paymentTerms.ts.
export function earlyPayDiscountCents(terms: string | null, invoiceDate: string, paidDate: string, subtotalCents: number): number {
  return discountCentsFor(parseEarlyPayTerms(terms), invoiceDate, paidDate, subtotalCents);
}

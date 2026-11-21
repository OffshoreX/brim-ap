import type { ReleasePayment, ReleaseResult, ReleaseTier, ReleaseUser } from "./types";

// Roles that may prepare a payment (P09: AP clerks prepare). Releasing is a separate, stricter check.
export const PREPARE_ROLES = ["ap_clerk", "finance_manager", "controller_admin"] as const;
// Never release, whatever the tier table says (P09, P11): a bad table row cannot open this door.
const NEVER_RELEASE = ["ap_clerk", "approver"];

// Limits come in as `tiers` (from approval policy P09/P10), so no amount is written in this file.
export function canRelease(user: ReleaseUser, payment: ReleasePayment, tiers: readonly ReleaseTier[]): ReleaseResult {
  if (NEVER_RELEASE.includes(user.role)) return { allowed: false, reason: `Role ${user.role} cannot release payments` };
  if (!Number.isInteger(payment.amountCadCents) || payment.amountCadCents <= 0) {
    return { allowed: false, reason: "Payment amount must be a positive whole number of cents" };
  }
  const tier = tiers.find((t) => t.upToCents === null || payment.amountCadCents <= t.upToCents);
  if (!tier) return { allowed: false, reason: "No release tier covers this amount" };
  if (!tier.roles.includes(user.role)) return { allowed: false, reason: `Role ${user.role} cannot release a payment of this size` };
  // P11: separation of duties.
  if (payment.approverIds.includes(user.id)) return { allowed: false, reason: "You approved this invoice, so you cannot release its payment" };
  if (payment.preparedBy === user.id) return { allowed: false, reason: "You prepared this payment, so you cannot release it" };
  return { allowed: true };
}

const DAY_MS = 86_400_000;

// Vendor terms look like "2/10 net 30": 2% off the subtotal if paid within 10 days of the invoice date.
// Integer math: percent becomes basis points, result rounds half up. Anything else means no discount.
export function earlyPayDiscountCents(terms: string | null, invoiceDate: string, paidDate: string, subtotalCents: number): number {
  const m = /^(\d+(?:\.\d+)?)\/(\d+) net \d+$/.exec(terms ?? "");
  if (!m) return 0;
  const days = (Date.parse(paidDate) - Date.parse(invoiceDate)) / DAY_MS;
  if (!(days >= 0 && days <= Number(m[2]))) return 0;
  return Math.round((subtotalCents * Math.round(Number(m[1]) * 100)) / 10_000);
}

"use client";
import Link from "next/link";
import type { MeResponse } from "@/contracts";
import { Icon } from "./icons";
import { useApi } from "./api";
import { Skeleton } from "./ui";

type Summary = { summary: Record<string, number> };
// Looks only: other roles never even ask, so they are not sent a 403. The server still checks the role on the call.
const ALLOWED = ["finance_manager", "controller_admin", "auditor"];

// One card, one link. A failed call says so by name; it never renders nothing.
export default function ReconCard() {
  const role = useApi<MeResponse>("/api/me").data?.user.role;
  const { data, error } = useApi<Summary>(role && ALLOWED.includes(role) ? "/api/reconciliation?limit=1" : null);
  if (!role || !ALLOWED.includes(role)) return null;
  if (error) return <p role="alert" className="error-box">Reconciliation summary could not load (GET /api/reconciliation): {error}</p>;
  if (!data) return <Skeleton rows={1} />;
  const s = data.summary;
  const attention = s.payment_unmatched + s.payment_ambiguous + s.amount_diff + s.duplicate + s.bank_no_payment + s.card_no_payment;
  return (
    <section aria-label="Reconciliation" className="cards big">
      <Link className={`card${attention > 0 ? " warn" : ""}`} href="/reconciliation">
        {attention > 0 && <Icon name="warning" />}Need attention<strong>{attention}</strong>
        <span className="means">Payments or bank and card lines with no clean match, an amount difference or a duplicate. Reconciled payments: {s.matched}.</span>
      </Link>
    </section>
  );
}

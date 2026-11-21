"use client";
import Link from "next/link";
import type { MeResponse } from "@/contracts";
import { useApi } from "./api";

type Summary = { summary: Record<string, number> };
// Looks only: other roles never even ask, so they are not sent a 403. The server still checks the role on the call.
const ALLOWED = ["finance_manager", "controller_admin", "auditor"];

export default function ReconCard() {
  const role = useApi<MeResponse>("/api/me").data?.user.role;
  const { data } = useApi<Summary>(role && ALLOWED.includes(role) ? "/api/reconciliation?limit=1" : null);
  if (!data) return null;
  const s = data.summary;
  const attention = s.payment_unmatched + s.payment_ambiguous + s.amount_diff + s.duplicate + s.bank_no_payment + s.card_no_payment;
  return (
    <section aria-label="Reconciliation" className="cards">
      <Link className="card" href="/reconciliation">Reconciled payments<strong>{s.matched}</strong></Link>
      <Link className="card" href="/reconciliation">Need attention<strong>{attention}</strong></Link>
      <Link className="card" href="/reconciliation">Amount differences<strong>{s.amount_diff}</strong></Link>
    </section>
  );
}

"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Role } from "@/contracts";
import { call, money } from "./api";
import { useCurrentUser } from "./CurrentUser";
import { Icon } from "./icons";

// Looks only: where each role lands and which numbers it sees. The server still decides what each call may do.
// `means` is the one plain line saying what the number counts, worded from the query behind it. `warn` counters turn amber above zero.
type Counter = { label: string; url: string; value: (data: unknown) => string | number | undefined; href?: string; means: string; warn?: boolean };
const list = (d: unknown) => (Array.isArray(d) ? d : undefined);
const count = (d: unknown) => list(d)?.length;
const withStatus = (status: string) => (d: unknown) => list(d)?.filter((i) => i?.status === status).length;
const dash = (key: string) => (d: unknown) => (d as Record<string, number> | undefined)?.[key];

export const HOME: Record<Role, { path: string; about: string; counters: Counter[] }> = {
  employee: {
    path: "/invoices",
    about: "Submit an invoice below and follow it until it is paid.",
    counters: [
      { label: "My invoices", url: "/api/invoices", value: count, means: "Invoices you submitted, in any status." },
      { label: "Waiting for approval", url: "/api/invoices", value: withStatus("pending_approval"), means: "Your invoices whose status is Pending approval." },
      { label: "Needs review", url: "/api/invoices", value: withStatus("needs_review"), means: "Your invoices whose status is Needs review: a check raised a flag and a clerk has not cleared it.", warn: true },
    ],
  },
  approver: {
    path: "/approvals",
    about: "Approve or reject the invoices waiting for you.",
    counters: [
      { label: "Waiting for me", url: "/api/approvals/inbox", value: count, href: "/approvals", means: "Invoices whose current approval step is assigned to you.", warn: true },
      { label: "Pending approval (all)", url: "/api/invoices", value: withStatus("pending_approval"), href: "/invoices?status=pending_approval", means: "Every invoice you can see whose status is Pending approval." },
      { label: "Rejected", url: "/api/invoices", value: withStatus("rejected"), href: "/invoices?status=rejected", means: "Invoices whose status is Rejected." },
    ],
  },
  ap_clerk: {
    path: "/upload",
    about: "Upload invoices, then clear the exceptions the checks flagged.",
    counters: [
      { label: "Flagged", url: "/api/exceptions", value: count, href: "/exceptions", means: "Invoices whose status is Needs review: each has at least one flag to clear.", warn: true },
      { label: "Needs review", url: "/api/invoices", value: withStatus("needs_review"), href: "/invoices?status=needs_review", means: "Invoices whose status is Needs review.", warn: true },
      { label: "Ready to pay", url: "/api/invoices", value: withStatus("approved"), href: "/payments", means: "Invoices whose status is Approved and not yet scheduled for payment." },
    ],
  },
  finance_manager: {
    path: "/payments",
    about: "Prepare and release payments; approvals waiting for you are in the queue.",
    counters: [
      { label: "Waiting for me", url: "/api/approvals/inbox", value: count, href: "/approvals", means: "Invoices whose current approval step is assigned to you.", warn: true },
      { label: "Ready to pay", url: "/api/invoices", value: withStatus("approved"), href: "/payments", means: "Invoices whose status is Approved and not yet scheduled for payment." },
      { label: "Ready to release", url: "/api/payments", value: withStatus("scheduled"), href: "/payments", means: "Payments whose status is Scheduled, waiting for you to release them." },
    ],
  },
  controller_admin: {
    path: "/dashboard",
    about: "Watch the whole pipeline; set approval rules and read the audit log.",
    counters: [
      { label: "Needs review", url: "/api/dashboard", value: dash("needsReview"), href: "/exceptions", means: "Invoices whose status is Needs review: a check raised a flag and none has been cleared yet.", warn: true },
      { label: "Pending approval", url: "/api/dashboard", value: (d) => (d as { countsByStatus?: Record<string, number> })?.countsByStatus?.pending_approval ?? 0, href: "/approvals", means: "Invoices whose status is Pending approval." },
      { label: "Due this week", url: "/api/dashboard", value: (d) => { const c = dash("dueThisWeekCadCents")(d); return c === undefined ? undefined : money(c, "CAD"); }, means: "Unpaid, unrejected invoices due today through the next 6 days, in CAD." },
    ],
  },
  auditor: {
    path: "/audit",
    about: "Read-only view of every change: who did what, when, before and after.",
    counters: [
      { label: "Audit events (latest)", url: "/api/audit", value: count, means: "Events in the latest page of the audit log." },
      { label: "Payments", url: "/api/payments", value: count, href: "/payments", means: "Payments scheduled or settled." },
      { label: "Invoices", url: "/api/invoices", value: count, href: "/invoices", means: "Every invoice, in any status." },
    ],
  },
};

// One request per distinct endpoint, then each counter picks its number. An error shows "–", never a guess.
export async function loadCounters(role: Role) {
  const spec = HOME[role].counters;
  const data = new Map(await Promise.all([...new Set(spec.map((c) => c.url))].map(async (u) => [u, await call(u)] as const)));
  return spec.map((c) => {
    const r = data.get(c.url)!;
    return { label: c.label, href: c.href, value: r.error ? "–" : (c.value(r.data) ?? "–") };
  });
}

// Shown at the top of the page the signed-in role lands on; renders nothing on any other page.
export default function RoleHome({ page }: { page: string }) {
  const { role } = useCurrentUser();
  const [counters, setCounters] = useState<Awaited<ReturnType<typeof loadCounters>>>();
  useEffect(() => {
    if (role && HOME[role].path === page) loadCounters(role).then(setCounters);
  }, [role, page]);
  if (!role || HOME[role].path !== page) return null;
  return (
    <section aria-label="Your home" className="home">
      <p className="about">{HOME[role].about}</p>
      <div className="cards big">
        {HOME[role].counters.map((c, i) => {
          const n = counters?.[i].value;
          const alert = c.warn && typeof n === "number" && n > 0; // warning trio: colour + icon + the plain line below
          const cls = `card${i === 0 ? " primary" : ""}${alert ? " warn" : ""}`;
          const body = <>{alert && <Icon name="warning" />}{c.label}<strong>{n ?? "…"}</strong><span className="means">{c.means}</span></>;
          return c.href ? <Link key={c.label} className={cls} href={c.href}>{body}</Link> : <div key={c.label} className={cls}>{body}</div>;
        })}
      </div>
      {role === "controller_admin" && <p><Link href="/admin/approval-rules">Approval rules</Link> · <Link href="/audit">Audit log</Link></p>}
    </section>
  );
}

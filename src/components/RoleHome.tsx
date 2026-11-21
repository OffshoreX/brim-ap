"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MeResponse, Role } from "@/contracts";
import { call, money, useApi } from "./api";

// Looks only: where each role lands and which numbers it sees. The server still decides what each call may do.
type Counter = { label: string; url: string; value: (data: unknown) => string | number | undefined; href?: string };
const list = (d: unknown) => (Array.isArray(d) ? d : undefined);
const count = (d: unknown) => list(d)?.length;
const withStatus = (status: string) => (d: unknown) => list(d)?.filter((i) => i?.status === status).length;
const dash = (key: string) => (d: unknown) => (d as Record<string, number> | undefined)?.[key];

export const HOME: Record<Role, { path: string; about: string; counters: Counter[] }> = {
  employee: {
    path: "/invoices",
    about: "Submit an invoice below and follow it until it is paid.",
    counters: [
      { label: "My invoices", url: "/api/invoices", value: count },
      { label: "Waiting for approval", url: "/api/invoices", value: withStatus("pending_approval") },
      { label: "Needs review", url: "/api/invoices", value: withStatus("needs_review") },
    ],
  },
  approver: {
    path: "/approvals",
    about: "Approve or reject the invoices waiting for you.",
    counters: [
      { label: "Waiting for me", url: "/api/approvals/inbox", value: count, href: "/approvals" },
      { label: "Pending approval (all)", url: "/api/invoices", value: withStatus("pending_approval"), href: "/invoices" },
      { label: "Rejected", url: "/api/invoices", value: withStatus("rejected"), href: "/invoices" },
    ],
  },
  ap_clerk: {
    path: "/upload",
    about: "Upload invoices, then clear the exceptions the checks flagged.",
    counters: [
      { label: "Flagged", url: "/api/exceptions", value: count, href: "/exceptions" },
      { label: "Needs review", url: "/api/invoices", value: withStatus("needs_review"), href: "/invoices" },
      { label: "Ready to pay", url: "/api/invoices", value: withStatus("approved"), href: "/payments" },
    ],
  },
  finance_manager: {
    path: "/payments",
    about: "Prepare and release payments; approvals waiting for you are in the queue.",
    counters: [
      { label: "Waiting for me", url: "/api/approvals/inbox", value: count, href: "/approvals" },
      { label: "Ready to pay", url: "/api/invoices", value: withStatus("approved") },
      { label: "Ready to release", url: "/api/payments", value: withStatus("scheduled") },
    ],
  },
  controller_admin: {
    path: "/dashboard",
    about: "Watch the whole pipeline; set approval rules and read the audit log.",
    counters: [
      { label: "Needs review", url: "/api/dashboard", value: dash("needsReview"), href: "/exceptions" },
      { label: "Pending approval", url: "/api/dashboard", value: (d) => (d as { countsByStatus?: Record<string, number> })?.countsByStatus?.pending_approval ?? 0, href: "/approvals" },
      { label: "Due this week", url: "/api/dashboard", value: (d) => { const c = dash("dueThisWeekCadCents")(d); return c === undefined ? undefined : money(c, "CAD"); } },
    ],
  },
  auditor: {
    path: "/audit",
    about: "Read-only view of every change: who did what, when, before and after.",
    counters: [
      { label: "Audit events (latest)", url: "/api/audit", value: count },
      { label: "Payments", url: "/api/payments", value: count, href: "/payments" },
      { label: "Invoices", url: "/api/invoices", value: count, href: "/invoices" },
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
  const { data } = useApi<MeResponse>("/api/me");
  const role = data?.user.role;
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
          const body = <>{c.label}<strong>{counters?.[i].value ?? "…"}</strong></>;
          return c.href ? <Link key={c.label} className="card" href={c.href}>{body}</Link> : <div key={c.label} className="card">{body}</div>;
        })}
      </div>
      {role === "controller_admin" && <p><Link href="/admin/approval-rules">Approval rules</Link> · <Link href="/audit">Audit log</Link></p>}
    </section>
  );
}

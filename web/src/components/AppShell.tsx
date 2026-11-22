import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard, FileText, Upload, CheckSquare, AlertTriangle, Wallet, Building2, BarChart3, Scale,
  ShieldCheck, Activity, Settings2, LogOut, PanelLeftClose, PanelLeftOpen, Anchor,
} from "lucide-react";
import { useMe } from "@/hooks/queries";
import { api, ApiError } from "@/lib/api";
import { can, ROLE_LABEL, type Capability } from "@/lib/roles";
import { initials } from "@/lib/format";
import { MockBanner } from "./MockBanner";
import { Loading, ErrorState } from "./States";
import { cn } from "@/lib/utils";
import type { Me } from "@/lib/types";

const NAV: { to: string; label: string; icon: typeof FileText; cap?: Capability }[] = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/upload", label: "Upload", icon: Upload, cap: "upload" },
  { to: "/approvals", label: "Approvals", icon: CheckSquare, cap: "approvals" },
  { to: "/exceptions", label: "Exceptions", icon: AlertTriangle, cap: "exceptionsHistory" },
  { to: "/payments", label: "Payments", icon: Wallet, cap: "payments" },
  { to: "/vendors", label: "Vendors", icon: Building2, cap: "vendors" },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/reconciliation", label: "Reconciliation", icon: Scale, cap: "reconciliation" },
  { to: "/audit", label: "Audit log", icon: ShieldCheck, cap: "audit" },
  { to: "/activity", label: "Activity log", icon: Activity, cap: "activity" },
  { to: "/admin", label: "Approval rules", icon: Settings2, cap: "admin" },
];

export function LogoMark({ className }: { className?: string }) {
  return <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-brand-warm text-brand-warm-foreground", className)}><Anchor className="h-5 w-5" aria-hidden /></span>;
}

/** Wraps every signed-in page: loads /api/me, redirects to /login on 401, renders sidebar. */
export function AppShell({ children }: { children: (me: Me) => ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) void navigate({ to: "/login" });
  }, [me.error, navigate]);

  if (me.isPending) return <><MockBanner /><Loading label="Signing you in…" /></>;
  if (me.error) return <><MockBanner /><div className="p-8"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div></>;
  const user = me.data;

  async function signOut() {
    setSigningOut(true);
    try { await api.logout(); } finally { qc.clear(); setSigningOut(false); void navigate({ to: "/login" }); }
  }

  const items = NAV.filter((n) => !n.cap || can(user.role, n.cap));
  const isActive = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));

  return (
    <div className="min-h-screen">
      <div className="flex">
        <aside className={cn("sticky top-0 flex h-screen shrink-0 flex-col glass-dark", collapsed ? "w-16" : "w-64")}>
          <div className="flex items-center gap-3 px-3.5 py-5">
            <LogoMark />
            {!collapsed && <div className="leading-tight"><p className="font-bold text-sidebar-primary">Harborline AP</p><p className="text-xs">Harborline Logistics</p></div>}
          </div>
          <nav className="flex-1 overflow-y-auto px-2" aria-label="Main">
            <ul className="space-y-0.5">
              {items.map((n) => (
                <li key={n.to}>
                  <Link to={n.to} title={collapsed ? n.label : undefined}
                    className={cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-sidebar-ring",
                      isActive(n.to) && "bg-sidebar-accent text-sidebar-accent-foreground")}>
                    <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    {collapsed ? <span className="sr-only">{n.label}</span> : n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="border-t border-sidebar-border p-2">
            <div className="flex items-center gap-3 px-1.5 py-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground" aria-hidden>{initials(user.name)}</span>
              {!collapsed && <div className="min-w-0 leading-tight"><p className="truncate text-sm font-semibold text-sidebar-primary">{user.name}</p><p className="text-xs">{ROLE_LABEL[user.role]}</p></div>}
            </div>
            <button onClick={signOut} disabled={signingOut} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-60">
              <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden />{collapsed ? <span className="sr-only">Sign out</span> : signingOut ? "Signing out…" : "Sign out"}
            </button>
            <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden /> : <><PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />Collapse</>}
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1"><MockBanner /><div className="px-6 py-8 md:px-10 md:py-10"><div className="mx-auto max-w-7xl">{children(user)}</div></div></main>
      </div>
    </div>
  );
}

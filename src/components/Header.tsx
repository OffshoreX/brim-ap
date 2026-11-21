"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MeResponse, Role } from "@/contracts";
import { FORBIDDEN, post, useApi } from "./api";
import { LogoMark } from "./icons";

// Which links each role sees. Looks only: the server still answers 403 on any page or call the role may not use.
const ALL: Role[] = ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"];
const LINKS: [string, string, Role[]][] = [
  ["/dashboard", "Dashboard", ALL],
  ["/invoices", "Invoices", ALL],
  ["/upload", "Upload", ["employee", "ap_clerk", "controller_admin"]],
  ["/approvals", "Approvals", ["approver", "finance_manager", "controller_admin"]],
  ["/exceptions", "Exceptions", ["ap_clerk", "finance_manager", "controller_admin"]],
  ["/payments", "Payments", ["ap_clerk", "finance_manager", "controller_admin", "auditor"]],
  ["/reports", "Reports", ["finance_manager", "controller_admin", "auditor"]],
  ["/vendors", "Vendors", ["ap_clerk", "finance_manager", "controller_admin", "auditor"]],
  ["/audit", "Audit log", ["controller_admin", "auditor"]],
  ["/admin/approval-rules", "Approval rules", ["controller_admin"]],
  ["/inbox", "Inbox", ["ap_clerk", "controller_admin", "auditor"]],
];
export const linksFor = (role?: Role) => LINKS.filter(([, , roles]) => role && roles.includes(role));

export default function Header() {
  // The layout stays mounted between pages, so ask again whenever the path changes (e.g. right after login).
  const path = usePathname();
  const { data, error } = useApi<MeResponse>(`/api/me?at=${encodeURIComponent(path)}`);
  const router = useRouter();
  // A 403 from any call lands here as the server's own message; it clears when the page changes.
  const [denied, setDenied] = useState<string>();
  useEffect(() => {
    const on = (e: Event) => setDenied((e as CustomEvent<string>).detail);
    window.addEventListener(FORBIDDEN, on);
    return () => window.removeEventListener(FORBIDDEN, on);
  }, []);
  useEffect(() => setDenied(undefined), [path]);
  async function signOut() {
    await post("/api/logout", {}); // clears the cookie; the login page works even if this fails
    router.push("/login");
  }
  return (
    <>
    <a href="#main" className="skip">Skip to content</a>
    <header className="topbar">
      <Link href="/" className="brand"><LogoMark /> Harborline AP</Link>
      <nav aria-label="Main">
        {linksFor(data?.user.role).map(([href, label]) => (
          <Link key={href} href={href} aria-current={path === href || path.startsWith(href + "/") ? "page" : undefined}>{label}</Link>
        ))}
      </nav>
      <span className="who">
        {data ? <>{data.user.name} <span className="role">{data.user.role.replaceAll("_", " ")}</span></> : error ? "Not signed in" : "…"}{" "}
        {data ? <button className="secondary" onClick={signOut}>Sign out</button> : <Link href="/login">Sign in</Link>}
      </span>
    </header>
    {denied && <div role="alert" className="banner">{denied} <button className="secondary" onClick={() => setDenied(undefined)}>Dismiss</button></div>}
    </>
  );
}

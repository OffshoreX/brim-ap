"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MeResponse } from "@/contracts";
import { post, useApi } from "./api";

// Every link is shown to everyone; the server answers 403 on pages a role may not use.
const LINKS: [string, string][] = [
  ["/dashboard", "Dashboard"], ["/invoices", "Invoices"], ["/approvals", "Approvals"], ["/exceptions", "Exceptions"],
  ["/payments", "Payments"], ["/vendors", "Vendors"], ["/audit", "Audit log"], ["/admin/approval-rules", "Approval rules"], ["/inbox", "Inbox"],
];

export default function Header() {
  // The layout stays mounted between pages, so ask again whenever the path changes (e.g. right after login).
  const path = usePathname();
  const { data, error } = useApi<MeResponse>(`/api/me?at=${encodeURIComponent(path)}`);
  const router = useRouter();
  async function signOut() {
    await post("/api/logout", {}); // clears the cookie; the login page works even if this fails
    router.push("/login");
  }
  return (
    <header>
      <nav aria-label="Main">
        {LINKS.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
      </nav>
      <span className="who">
        {data ? `${data.user.name} (${data.user.role})` : error ? "Not signed in" : "…"}{" "}
        {data ? <button onClick={signOut}>Sign out</button> : <Link href="/login">Sign in</Link>}
      </span>
    </header>
  );
}

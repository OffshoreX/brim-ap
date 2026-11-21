"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, type MeResponse, type Role, type UsersResponse } from "@/contracts";
import { call, Load, Notice, post } from "@/components/api";
import { HOME } from "@/components/RoleHome";

const WORD: Record<Role, string> = { employee: "Submits", approver: "Approves", ap_clerk: "Processes", finance_manager: "Pays", controller_admin: "Governs", auditor: "Audits" };
// /api/users only sends id, name and role today (see PR), so a missing status counts as active.
type Person = UsersResponse["users"][number] & { status?: string };

// GET /api/users (public, demo users) and POST /api/login.
export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function login(userId: number) {
    const r = await post<MeResponse>("/api/login", { userId });
    if (r.error) return setError(r.error);
    const me = await call<MeResponse>("/api/me"); // the role comes from the server, never from the picker
    router.push(me.data ? HOME[me.data.user.role].path : "/dashboard");
  }

  return (
    <main id="main">
      <h1>Sign in</h1>
      <Load<UsersResponse> url="/api/users">
        {({ users }) => (
          <div className="personas">
            {ROLES.map((role) => (
              <section key={role}>
                <h2>{role.replaceAll("_", " ")}</h2>
                {(users as Person[]).filter((u) => u.role === role).map((u) => {
                  const off = u.status && u.status !== "active";
                  return (
                    <button key={u.id} className={off ? "persona off" : "persona"} onClick={() => login(u.id)}>
                      {u.name}<small>{WORD[role]}{off ? ` · ${u.status!.replace("_", " ")}` : ""}</small>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </Load>
      <Notice error={error} />
    </main>
  );
}

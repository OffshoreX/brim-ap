"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ROLES, type MeResponse, type Role, type UsersResponse } from "@/contracts";
import { call, Notice, post, useApi } from "@/components/api";
import { HOME } from "@/components/RoleHome";

const WORD: Record<Role, string> = { employee: "Submits", approver: "Approves", ap_clerk: "Processes", finance_manager: "Pays", controller_admin: "Governs", auditor: "Audits" };

// POST /api/login with { email, password }. The server answers 401 (wrong details) or 429 (locked, its text says how long to wait).
// The Demo panel appears only when GET /api/users answers; the server hides it (404) unless DEMO_PERSONA_PICKER=1.
export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const demo = useApi<UsersResponse>("/api/users").data?.users;

  async function enter(body: unknown) {
    setBusy(true);
    setError(undefined);
    const r = await post<MeResponse>("/api/login", body);
    if (r.error) {
      setBusy(false);
      return setError(r.error);
    }
    const me = await call<MeResponse>("/api/me"); // the role comes from the server, never from the form
    router.push(me.data ? HOME[me.data.user.role].path : "/dashboard");
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    enter({ email: String(f.get("email")), password: String(f.get("password")) }); // never logged or stored
  }

  return (
    <main id="main">
      <h1>Sign in</h1>
      <form onSubmit={submit} className="panel">
        <p><label>Email <input name="email" type="email" autoComplete="username" required /></label></p>
        <p>
          <label>Password <input name="password" type={show ? "text" : "password"} autoComplete="current-password" required /></label>{" "}
          <button type="button" className="secondary" aria-pressed={show} onClick={() => setShow(!show)}>{show ? "Hide" : "Show"} password</button>
        </p>
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <Notice error={error} />
      {demo && (
        <section aria-label="Demo">
          <h2>Demo</h2>
          <p>Pick a sample person to explore without a password.</p>
          <div className="personas">
            {ROLES.map((role) => (
              <section key={role}>
                <h2>{role.replaceAll("_", " ")}</h2>
                {demo.filter((u) => u.role === role).map((u) => (
                  <button key={u.id} className="persona" disabled={busy} onClick={() => enter({ userId: u.id })}>{u.name}<small>{WORD[role]}</small></button>
                ))}
              </section>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MeResponse } from "@/contracts";
import { Load, Notice, post } from "@/components/api";
import type { UsersResponse } from "@/contracts";

// GET /api/users (public, demo users) and POST /api/login.
export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function login(userId: string) {
    const r = await post<MeResponse>("/api/login", { userId: Number(userId) });
    if (r.error) setError(r.error);
    else router.push("/dashboard");
  }

  return (
    <main>
      <h1>Sign in</h1>
      <Load<UsersResponse> url="/api/users">
        {({ users }) => (
          <select defaultValue="" onChange={(e) => login(e.target.value)} aria-label="User">
            <option value="" disabled>Pick a user…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
          </select>
        )}
      </Load>
      <Notice error={error} />
    </main>
  );
}

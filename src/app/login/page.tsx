"use client";
import { useEffect, useState } from "react";
import type { UsersResponse } from "@/contracts";

export default function LoginPage() {
  const [users, setUsers] = useState<UsersResponse["users"]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d: UsersResponse) => setUsers(d.users));
  }, []);

  async function login(userId: string) {
    if (!userId) return;
    const res = await fetch("/api/login", { method: "POST", body: JSON.stringify({ userId: Number(userId) }) });
    const data = await res.json();
    setMsg(res.ok ? `Signed in as ${data.user.name} (${data.user.role})` : data.error);
  }

  return (
    <main>
      <h1>Sign in</h1>
      <select defaultValue="" onChange={(e) => login(e.target.value)} aria-label="User">
        <option value="" disabled>Pick a user…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.name} — {u.role}</option>
        ))}
      </select>
      <p>{msg}</p>
    </main>
  );
}

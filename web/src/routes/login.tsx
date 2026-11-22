import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { pageHead } from "@/lib/seo";
import { LogoMark } from "@/components/AppShell";
import { MockBanner } from "@/components/MockBanner";
import { ErrorText } from "@/components/ErrorText";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => pageHead("Sign in", "Sign in to Harborline AP, accounts payable for Harborline Logistics."),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // POST /api/login — sets the HttpOnly session cookie; the server's own error text (wrong password, rate limit) is shown as is
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.login(email, password);
      qc.clear(); // drop anything cached for the previous user; the shell then reads the full user from /api/me
      void navigate({ to: "/" });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen">
      <MockBanner />
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <form onSubmit={submit} className="w-full max-w-sm glass rounded-2xl p-8">
          <LogoMark className="h-11 w-11" />
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground">Sign in to Harborline AP</h1>
          <p className="mt-1 text-sm text-muted-foreground">Accounts payable for Harborline Logistics</p>
          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <ErrorText error={error} />
            <Button type="submit" className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertOctagon, Inbox, Lock, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-10 justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> {label}
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="flex flex-col items-center gap-2 surface rounded-xl py-12 text-center">
      <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="font-semibold text-foreground">Your role can't see this</p>
      <p className="text-sm text-muted-foreground">Ask a controller if you need access.</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) return <Forbidden />;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-bad-foreground/30 bg-bad p-4 text-bad-foreground">
      <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold">Couldn't load this</p>
        <p className="text-sm">{msg}</p>
      </div>
      {onRetry && <button onClick={onRetry} className="min-h-9 rounded-md border border-current px-3 text-sm font-medium">Try again</button>}
    </div>
  );
}

export function Empty({ title, children, to, linkLabel }: { title: string; children?: ReactNode; to?: string; linkLabel?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="font-semibold text-foreground">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
      {to && linkLabel && <Link to={to} className="mt-1 text-sm font-semibold text-primary underline-offset-4 hover:underline">{linkLabel} →</Link>}
    </div>
  );
}

/** Renders loading / error / content for a query. */
export function QueryView<D>({ q, children }: { q: { isPending: boolean; error: unknown; data: D | undefined; refetch: () => unknown }; children: (d: D) => ReactNode }) {
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <>{children(q.data as D)}</>;
}

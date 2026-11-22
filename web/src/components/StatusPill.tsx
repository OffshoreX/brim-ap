import { CheckCircle2, AlertTriangle, XCircle, Info, HelpCircle, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "bad" | "info" | "neutral";
const MAP: Record<string, { tone: Tone; label: string }> = {
  approved: { tone: "ok", label: "Approved" },
  scheduled: { tone: "ok", label: "Scheduled" },
  paid: { tone: "ok", label: "Paid" },
  settled: { tone: "ok", label: "Settled" },
  released: { tone: "ok", label: "Released" },
  verified: { tone: "ok", label: "Verified" },
  active: { tone: "ok", label: "Active" },
  ok: { tone: "ok", label: "Done" },
  needs_review: { tone: "warn", label: "Needs review" },
  pending_approval: { tone: "warn", label: "Pending approval" },
  pending: { tone: "warn", label: "Pending" },
  prepared: { tone: "warn", label: "Prepared" },
  pending_verification: { tone: "warn", label: "Awaiting callback" },
  on_hold: { tone: "warn", label: "On hold" },
  warn: { tone: "warn", label: "Warning" },
  rejected: { tone: "bad", label: "Rejected" },
  blocked: { tone: "bad", label: "Blocked" },
  failed: { tone: "bad", label: "Failed" },
  error: { tone: "bad", label: "Error" },
  received: { tone: "info", label: "Received" },
  processing: { tone: "info", label: "Processing" },
  running: { tone: "info", label: "Running" },
  waiting: { tone: "neutral", label: "Waiting" },
  flagged: { tone: "warn", label: "Flagged" },
  skipped: { tone: "neutral", label: "Skipped" },
};
const ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle, info: Info, neutral: HelpCircle };
const TONE: Record<Tone, string> = {
  ok: "bg-ok text-ok-foreground",
  warn: "bg-warn text-warn-foreground",
  bad: "bg-bad text-bad-foreground",
  info: "bg-info text-info-foreground",
  neutral: "bg-neutral text-neutral-foreground",
};

// label overrides the built-in wording when the server already sends a human label (for example a payment's statusLabel).
export function StatusPill({ status, label, className }: { status: string; label?: string; className?: string }) {
  const m = MAP[status] ?? { tone: "neutral" as Tone, label: status.replace(/_/g, " ") || "Unknown" };
  const Icon = status === "processing" || status === "running" ? Loader2 : status === "waiting" ? Clock : ICON[m.tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", TONE[m.tone], className)}>
      <Icon className={cn("h-3.5 w-3.5", status === "processing" || status === "running" ? "animate-spin motion-reduce:animate-none" : "")} aria-hidden />
      {label ?? m.label}
    </span>
  );
}

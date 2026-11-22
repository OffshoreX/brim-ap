import type { ApprovalStep } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/roles";
import { formatDateTime } from "@/lib/format";
import { StatusPill } from "./StatusPill";
import { cn } from "@/lib/utils";

export function ApprovalStepper({ steps }: { steps: ApprovalStep[] }) {
  if (!steps.length) return <p className="text-sm text-muted-foreground">No approval steps yet.</p>;
  return (
    <ol className="space-y-0">
      {[...steps].sort((a, b) => a.order - b.order).map((s, i, arr) => (
        <li key={s.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < arr.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-px bg-border" aria-hidden />}
          <span className={cn("num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", s.status === "approved" ? "bg-ok text-ok-foreground" : s.status === "rejected" ? "bg-bad text-bad-foreground" : s.status === "pending" ? "bg-warn text-warn-foreground" : "bg-neutral text-neutral-foreground")}>{s.order}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{s.approverName}</span>
              <span className="text-sm text-muted-foreground">{ROLE_LABEL[s.approverRole]}</span>
              <StatusPill status={s.status} />
            </div>
            {s.decidedAt && s.status !== "waiting" && s.status !== "pending" && <p className="text-xs text-muted-foreground">{formatDateTime(s.decidedAt)}</p>}
            {s.comment && <p className="mt-1 text-sm text-foreground">“{s.comment}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

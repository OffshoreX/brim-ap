import type { ApprovalChainStep, ApprovalDecision } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/roles";
import { formatDateTime } from "@/lib/format";
import { StatusPill } from "./StatusPill";
import { cn } from "@/lib/utils";

type Row = { key: string; no: number; who: string | null; role: string; status: string; decidedAt: string | null; comment: string | null };

const roleName = (role: string) => (ROLE_LABEL as Record<string, string>)[role] ?? (role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " "));

// The chain says who is asked; the decisions say what happened. Invoices approved before chains were stored have decisions only,
// and the decision rows carry no names, so those show the role.
function rows(chain: ApprovalChainStep[], decisions: ApprovalDecision[]): Row[] {
  if (chain.length)
    return chain.map((s) => {
      const d = decisions.find((x) => x.stepNo === s.stepNo);
      return { key: `c${s.stepNo}`, no: s.stepNo, who: s.userName, role: s.roleLabel, status: s.status, decidedAt: d?.decidedAt ?? null, comment: d?.comment || null };
    });
  return decisions.map((d) => ({ key: `d${d.id}`, no: d.stepNo, who: null, role: roleName(d.approverRole), status: d.decision, decidedAt: d.decidedAt, comment: d.comment || null }));
}

export function ApprovalStepper({ chain, decisions }: { chain: ApprovalChainStep[]; decisions: ApprovalDecision[] }) {
  const steps = rows(chain, decisions);
  if (!steps.length) return <p className="text-sm text-muted-foreground">No approval steps yet.</p>;
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-px bg-border" aria-hidden />}
          <span className={cn("num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", s.status === "approved" ? "bg-ok text-ok-foreground" : s.status === "rejected" ? "bg-bad text-bad-foreground" : s.status === "pending" ? "bg-warn text-warn-foreground" : "bg-neutral text-neutral-foreground")}>{s.no}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {s.who && <span className="font-semibold text-foreground">{s.who}</span>}
              <span className={s.who ? "text-sm text-muted-foreground" : "font-semibold text-foreground"}>{s.role}</span>
              <StatusPill status={s.status} />
            </div>
            {s.decidedAt && <p className="text-xs text-muted-foreground">{formatDateTime(s.decidedAt)}</p>}
            {s.comment && <p className="mt-1 text-sm text-foreground">“{s.comment}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

import { AlertTriangle, Info, XOctagon } from "lucide-react";
import type { Flag } from "@/lib/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const ORDER = { block: 0, warn: 1, info: 2 } as const;
export function worstFlag(flags: Flag[]): Flag["severity"] | null {
  return flags.length ? [...flags].sort((a, b) => ORDER[a.severity] - ORDER[b.severity])[0]!.severity : null;
}

// Every reason is visible text — never a tooltip.
export function FlagBox({ flags, footer }: { flags: Flag[]; footer?: ReactNode }) {
  const worst = worstFlag(flags);
  if (!worst) return null;
  const style = worst === "block" ? "bg-bad text-bad-foreground border-bad-foreground/30" : worst === "warn" ? "bg-warn text-warn-foreground border-warn-foreground/30" : "bg-info text-info-foreground border-info-foreground/30";
  const Icon = worst === "block" ? XOctagon : worst === "warn" ? AlertTriangle : Info;
  const title = worst === "block" ? "Blocked" : worst === "warn" ? "Needs attention" : "For your information";
  return (
    <div className={cn("rounded-xl border p-4", style)}>
      <div className="flex items-center gap-2 font-semibold"><Icon className="h-5 w-5" aria-hidden />{title} · {plural(flags.length, "flag")}</div>
      <ul className="mt-2 space-y-1.5 text-sm">
        {flags.map((f) => (
          <li key={f.id} className="flex gap-2"><span className="font-semibold uppercase text-xs mt-0.5 shrink-0">{f.severity === "block" ? "Blocking" : f.severity === "warn" ? "Warning" : "Info"}</span><span>{f.reason}</span></li>
        ))}
      </ul>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

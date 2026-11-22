import { AlertTriangle, Info, XOctagon } from "lucide-react";
import type { Flag } from "@/lib/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

// The server sorts flags worst first; this finds the worst one without trusting that.
const ORDER = { error: 0, warning: 1, info: 2 } as const;
export function worstFlag(flags: Flag[]): Flag["severity"] | null {
  return flags.length ? [...flags].sort((a, b) => ORDER[a.severity] - ORDER[b.severity])[0]!.severity : null;
}

const LOOK = {
  error: { box: "bg-bad text-bad-foreground border-bad-foreground/30", icon: XOctagon, title: "Problems found", tag: "Error" },
  warning: { box: "bg-warn text-warn-foreground border-warn-foreground/30", icon: AlertTriangle, title: "Needs attention", tag: "Warning" },
  info: { box: "bg-info text-info-foreground border-info-foreground/30", icon: Info, title: "For your information", tag: "Info" },
} as const;

// Every reason is visible text — never a tooltip.
export function FlagBox({ flags, footer }: { flags: Flag[]; footer?: ReactNode }) {
  const worst = worstFlag(flags);
  if (!worst) return null;
  const { box, icon: Icon, title } = LOOK[worst];
  return (
    <div className={cn("rounded-xl border p-4", box)}>
      <div className="flex items-center gap-2 font-semibold"><Icon className="h-5 w-5" aria-hidden />{title} · {plural(flags.length, "flag")}</div>
      <ul className="mt-2 space-y-1.5 text-sm">
        {flags.map((f, i) => (
          <li key={`${f.code}-${i}`} className="flex gap-2"><span className="font-semibold uppercase text-xs mt-0.5 shrink-0">{LOOK[f.severity].tag}</span><span>{f.message}</span></li>
        ))}
      </ul>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

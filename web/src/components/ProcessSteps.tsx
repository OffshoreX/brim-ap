import type { ProcessStep } from "@/lib/types";
import { StatusPill } from "./StatusPill";
import { formatDateTime } from "@/lib/format";
export function ProcessSteps({ steps, showTime }: { steps: ProcessStep[]; showTime?: boolean }) {
  return (
    <ol className="divide-y divide-border">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-3 py-2.5">
          <span className="num w-6 text-sm text-muted-foreground">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{s.step}</p>
            <p className="text-sm text-muted-foreground">{s.message}{showTime && ` · ${formatDateTime(s.at)}`}</p>
          </div>
          <StatusPill status={s.status} />
        </li>
      ))}
    </ol>
  );
}

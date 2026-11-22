import type { ProcessStep } from "@/lib/types";
import { StatusPill } from "./StatusPill";
import { formatDateTime } from "@/lib/format";
// step is a code name such as "tax_check"; show it as words. The server's detail text is shown as it is.
const words = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[_.]/g, " ");
export function ProcessSteps({ steps, showTime }: { steps: ProcessStep[]; showTime?: boolean }) {
  return (
    <ol className="divide-y divide-border">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-3 py-2.5">
          <span className="num w-6 text-sm text-muted-foreground">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{words(s.step)}{s.invoiceNumber && <span className="text-muted-foreground"> · {s.invoiceNumber}</span>}</p>
            <p className="text-sm text-muted-foreground">{s.detail}{showTime && ` · ${formatDateTime(s.createdAt)}`}</p>
          </div>
          <StatusPill status={s.status} />
        </li>
      ))}
    </ol>
  );
}

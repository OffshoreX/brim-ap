import { formatMoney } from "@/lib/format";
// Horizontal bars; full labels and values printed as text. Single grow animation (bar-grow).
export function BarChart({ rows, currency }: { rows: { label: string; cents: number; note?: string }[]; currency: string }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-foreground">{r.label}{r.note && <span className="ml-2 text-muted-foreground">{r.note}</span>}</span>
            <span className="num shrink-0 font-semibold text-foreground">{formatMoney(r.cents, currency)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted">
            <div className="bar-grow h-full rounded-full bg-chart-1" style={{ width: `${(r.cents / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

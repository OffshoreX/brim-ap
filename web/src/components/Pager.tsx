import { Button } from "@/components/ui/button";
export function Pager({ offset, limit, total, onPage, matching }: { offset: number; limit: number; total: number; onPage: (offset: number) => void; matching?: boolean }) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span className="num">{matching ? `Showing ${from.toLocaleString()} to ${to.toLocaleString()} of ${total.toLocaleString()} matching` : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}</span>
      <div className="flex gap-2">
        <Button variant="outline" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>Previous</Button>
        <Button variant="outline" disabled={to >= total} onClick={() => onPage(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}

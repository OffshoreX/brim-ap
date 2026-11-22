import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
export function Money({ cents, currency, className }: { cents: number; currency: string; className?: string }) {
  return <span className={cn("num whitespace-nowrap", className)}>{formatMoney(cents, currency)}</span>;
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto surface rounded-xl"><table className="w-full text-sm">{children}</table></div>;
}
export function Th({ children, right, center }: { children?: ReactNode; right?: boolean; center?: boolean }) {
  return <th scope="col" className={cn("border-b border-border bg-muted/60 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground", right ? "text-right" : center ? "text-center" : "text-left")}>{children}</th>;
}
export function Td({ children, right, center, className }: { children?: ReactNode; right?: boolean; center?: boolean; className?: string }) {
  return <td className={cn("border-b border-border px-4 py-3 align-middle text-foreground", right && "num text-right", center && "text-center", className)}>{children}</td>;
}

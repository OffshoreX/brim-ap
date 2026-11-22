import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export function Panel({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("surface rounded-xl p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
// Two-step inline confirm: first click reveals the sentence + Confirm/Cancel.
export function ConfirmInline({ label, message, onConfirm, pending, variant = "default", confirmLabel = "Confirm" }: {
  label: ReactNode; message: ReactNode; onConfirm: () => void; pending?: boolean; variant?: "default" | "destructive" | "outline"; confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant={variant} onClick={() => setOpen(true)} disabled={pending}>{label}</Button>;
  return (
    <div className="flex flex-wrap items-center gap-2 glass rounded-xl p-2">
      <span className="text-sm font-medium text-foreground">{message}</span>
      <Button variant={variant === "outline" ? "default" : variant} disabled={pending} onClick={() => { onConfirm(); setOpen(false); }}>{pending ? "Working…" : confirmLabel}</Button>
      <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/queries";
import { api } from "@/lib/api";
import type { InvoiceLine } from "@/lib/types";

// PATCH /api/invoices/:id/lines/:lineId/coding
export function LineCoding({ invoiceId, line, editable }: { invoiceId: string; line: InvoiceLine; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [gl, setGl] = useState(line.glAccount ?? "");
  const [cc, setCc] = useState(line.costCenter ?? "");
  const save = useAction(() => api.codeLine(invoiceId, line.id, { glAccount: gl, costCenter: cc }), [["invoice", invoiceId]]);
  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        {line.glAccount ? <span><span className="font-medium">{line.glAccount}</span>{line.costCenter && <span className="text-muted-foreground"> · {line.costCenter}</span>}</span> : <span className="font-medium text-warn-foreground">Not coded</span>}
        {editable && <Button variant="ghost" className="h-9 px-2 text-primary" onClick={() => setEditing(true)}>Edit</Button>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="GL account" placeholder="GL account" value={gl} onChange={(e) => setGl(e.target.value)} className="h-9 w-32" />
      <Input aria-label="Cost centre" placeholder="Cost centre" value={cc} onChange={(e) => setCc(e.target.value)} className="h-9 w-28" />
      <Button disabled={save.isPending || !gl} onClick={() => save.mutateAsync(undefined).then(() => { toast.success("Coding saved"); setEditing(false); }).catch((e: Error) => toast.error(e.message))}>{save.isPending ? "Saving…" : "Save"}</Button>
      <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
    </div>
  );
}

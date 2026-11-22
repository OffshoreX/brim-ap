import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notify } from "@/lib/notify";
import { ConfirmInline } from "@/components/ConfirmInline";
import { ErrorText } from "@/components/ErrorText";
import { Panel } from "@/components/Panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can } from "@/lib/roles";
import type { Me, VendorDetail } from "@/lib/types";

// Approve, hold and lift hold. Buttons show only to the roles the server lets through (looks only); every refusal
// the server still gives (the creator, a vendor already moved by someone else) is shown here as the server wrote it.
export function VendorStatus({ v, me }: { v: VendorDetail; me: Me }) {
  const keys = [["vendor", String(v.id)], ["vendors"], ["audit"]];
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const approve = useAction(() => api.approveVendor(v.id), keys);
  const hold = useAction((r: string) => api.holdVendor(v.id, r), keys);
  const lift = useAction(() => api.releaseVendorHold(v.id), keys);
  const run = (p: Promise<unknown>, ok: string) => {
    setError(null);
    p.then(() => { notify.money(ok); setReason(""); }).catch((e: Error) => {
      setError(e.message);
      void qc.invalidateQueries({ queryKey: keys[0]! }); // a refusal usually means the page is out of date: show the vendor as it is now
    });
  };
  const decide = can(me.role, "vendorDecide");

  let body = null;
  if (v.status === "pending_review") {
    body = !decide ? <p className="text-sm text-muted-foreground">A finance manager or controller must approve this vendor before invoices can be paid to it.</p>
      : v.created_by_user_id === me.id ? <p className="text-sm text-muted-foreground">You created this vendor, so someone else must approve it.</p>
      : <ConfirmInline label="Approve vendor" confirmLabel="Yes, approve" pending={approve.isPending} message={`Approve ${v.name} for payments?`} onConfirm={() => run(approve.mutateAsync(undefined), "Vendor approved")} />;
  } else if (v.status === "active" && decide) {
    body = (
      <div className="space-y-3">
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="hold-reason">Reason for the hold (required)</Label>
          <Input id="hold-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </div>
        <ConfirmInline label="Hold vendor" variant="destructive" confirmLabel="Yes, hold" pending={hold.isPending || !reason.trim()} message={`Hold ${v.name}? No payments will go to it until the hold is lifted.`} onConfirm={() => run(hold.mutateAsync(reason), "Vendor put on hold")} />
      </div>
    );
  } else if (v.status === "on_hold" && decide) {
    body = <ConfirmInline label="Lift hold" confirmLabel="Yes, lift it" pending={lift.isPending} message={`Put ${v.name} back in use?`} onConfirm={() => run(lift.mutateAsync(undefined), "Hold lifted")} />;
  }
  if (!body) return null;
  return <Panel title="Vendor status" className="mb-6"><div className="space-y-3">{body}<ErrorText error={error} /></div></Panel>;
}

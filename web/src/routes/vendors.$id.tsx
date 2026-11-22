import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { QueryView, Forbidden } from "@/components/States";
import { StatusPill } from "@/components/StatusPill";
import { ConfirmInline } from "@/components/ConfirmInline";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction, useVendor } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDateTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { Me, VendorDetail } from "@/lib/types";

export const Route = createFileRoute("/vendors/$id")({
  ssr: false,
  head: () => pageHead("Vendor", "Vendor details and bank change verification."),
  component: () => <AppShell>{(me) => (can(me.role, "vendors") ? <VendorPage me={me} /> : <Forbidden />)}</AppShell>,
});

function VendorPage({ me }: { me: Me }) {
  const { id } = Route.useParams();
  const q = useVendor(id);
  return <QueryView q={q}>{(v) => <VendorView v={v} me={me} />}</QueryView>;
}

function VendorView({ v, me }: { v: VendorDetail; me: Me }) {
  const keys = [["vendor", v.id], ["vendors"]];
  const [bank, setBank] = useState({ institution: "", transit: "", account: "" });
  const [verify, setVerify] = useState({ calledNumber: "", note: "" });
  const req = useAction(() => api.requestBankChange(v.id, bank), keys);
  const ver = useAction(() => api.verifyBankChange(v.id, verify), keys);
  const bc = v.bankChange;
  const bankValid = bank.institution.length === 3 && bank.transit.length === 5 && bank.account.length >= 5;

  return (
    <>
      <Link to="/vendors" className="text-sm font-medium text-muted-foreground hover:text-foreground">← Vendors</Link>
      <PageHeader title={v.name} subtitle={v.address ?? undefined} actions={<StatusPill status={v.status} />} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Details">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Email</dt><dd>{v.email ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Pays by</dt><dd>{v.paymentMethod.toUpperCase()}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Bank account</dt><dd className="num">{v.bankLast4 ? `•••• ${v.bankLast4}` : "—"}</dd></div>
          </dl>
        </Panel>
        <Panel title="Bank details change">
          {bc && bc.status === "pending_verification" ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-warn p-3 text-sm text-warn-foreground">
                <p className="font-semibold">Waiting for callback verification</p>
                <p>{bc.requestedBy} asked to change the account to •••• {bc.newBankLast4} on {formatDateTime(bc.requestedAt)}. Payments to this vendor are held until someone calls the vendor on a known number and confirms.</p>
              </div>
              {can(me.role, "bankVerify") ? (
                <div className="space-y-3">
                  <div className="space-y-1.5"><Label htmlFor="cn">Phone number you called (from vendor file, not the request)</Label><Input id="cn" value={verify.calledNumber} onChange={(e) => setVerify({ ...verify, calledNumber: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="vn">Who confirmed it</Label><Input id="vn" value={verify.note} onChange={(e) => setVerify({ ...verify, note: e.target.value })} /></div>
                  <ConfirmInline label="Mark verified" confirmLabel="Yes, verified" pending={ver.isPending}
                    message={`Confirm you called ${verify.calledNumber || "the vendor"} and they confirmed account •••• ${bc.newBankLast4}?`}
                    onConfirm={() => { if (!verify.calledNumber) { toast.error("Enter the number you called"); return; } ver.mutateAsync(undefined).then(() => toast.success("Bank change verified")).catch((e: Error) => toast.error(e.message)); }} />
                </div>
              ) : <p className="text-sm text-muted-foreground">A finance manager or controller must verify this change.</p>}
            </div>
          ) : can(me.role, "bankChange") ? (
            <div className="space-y-3">
              {bc?.status === "verified" && <p className="text-sm"><StatusPill status="verified" /> Last change to •••• {bc.newBankLast4} was verified.</p>}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label htmlFor="inst">Institution</Label><Input id="inst" inputMode="numeric" maxLength={3} value={bank.institution} onChange={(e) => setBank({ ...bank, institution: e.target.value.replace(/\D/g, "") })} /></div>
                <div className="space-y-1.5"><Label htmlFor="tr">Transit</Label><Input id="tr" inputMode="numeric" maxLength={5} value={bank.transit} onChange={(e) => setBank({ ...bank, transit: e.target.value.replace(/\D/g, "") })} /></div>
                <div className="space-y-1.5"><Label htmlFor="acct">Account</Label><Input id="acct" inputMode="numeric" maxLength={12} value={bank.account} onChange={(e) => setBank({ ...bank, account: e.target.value.replace(/\D/g, "") })} /></div>
              </div>
              <p className="text-xs text-muted-foreground">3-digit institution, 5-digit transit, account number.</p>
              <ConfirmInline label="Request bank change" confirmLabel="Submit request" pending={req.isPending}
                message={`Change ${v.name}'s account to •••• ${bank.account.slice(-4) || "????"}? Payments will be held until verified.`}
                onConfirm={() => { if (!bankValid) { toast.error("Check the institution, transit and account numbers"); return; } req.mutateAsync(undefined).then(() => { toast.success("Bank change requested"); setBank({ institution: "", transit: "", account: "" }); }).catch((e: Error) => toast.error(e.message)); }} />
            </div>
          ) : <p className="text-sm text-muted-foreground">No pending bank changes.</p>}
        </Panel>
      </div>
    </>
  );
}

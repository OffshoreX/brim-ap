import { useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { notify } from "@/lib/notify";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { QueryView, Forbidden } from "@/components/States";
import { StatusPill } from "@/components/StatusPill";
import { ConfirmInline } from "@/components/ConfirmInline";
import { VendorStatus } from "@/components/VendorStatus";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, Th, Td } from "@/components/Table";
import { useAction, useVendor } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDate, formatDateTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { BankChange, Me, VendorDetail } from "@/lib/types";

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

const CHANNELS = ["email", "phone", "vendor_portal"]; // the values the dataset uses for how the request arrived
const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{children}</dd></div>
);

function VendorView({ v, me }: { v: VendorDetail; me: Me }) {
  const keys = [["vendor", String(v.id)], ["vendors"], ["audit"]];
  const [bank, setBank] = useState({ institution: "", transit: "", account: "", channel: CHANNELS[0]! });
  // POST /api/vendors/:id/bank-change and /bank-change/verify
  const req = useAction(() => api.requestBankChange(v.id, bank), keys);
  const ver = useAction((verified: boolean) => api.verifyBankChange(v.id, verified), keys);
  const pending = v.bankChanges.find((c) => c.status === "pending");
  const bankValid = bank.institution.length === 3 && bank.transit.length === 5 && bank.account.length >= 4;
  const mine = pending?.changed_by_user_id === me.id; // looks only: the server refuses a self-verify with its own message
  const done = (msg: string) => () => notify.money(msg);
  const fail = (e: Error) => notify.error(e.message); // the server's own {error} text

  return (
    <>
      <Link to="/vendors" className="text-sm font-medium text-muted-foreground hover:text-foreground">← Vendors</Link>
      <PageHeader title={v.name} subtitle={v.address ?? undefined} actions={<StatusPill status={v.status} />} />
      <VendorStatus v={v} me={me} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Details">
          <dl className="space-y-2 text-sm">
            <Row k="Category">{v.category ?? "—"}</Row>
            <Row k="AP contact">{v.ap_contact_email ?? "—"}</Row>
            <Row k="Payment terms">{v.payment_terms_days === null ? "—" : `Net ${v.payment_terms_days} days`}{v.early_pay_discount ? ` (${v.early_pay_discount})` : ""}</Row>
            <Row k="Pays by">{v.preferred_payment_method ?? "—"}</Row>
            <Row k="Bank account"><span className="num">{v.bank_account_last4 ? `•••• ${v.bank_account_last4}` : "—"}</span></Row>
            <Row k="Bank details updated">{formatDate(v.bank_details_updated_at)}</Row>
            <Row k="GST/HST number">{v.gst_hst_number ?? "—"}</Row>
            <Row k="Needs a purchase order">{v.requires_po ? "Yes" : "No"}</Row>
            <Row k="Onboarded">{formatDate(v.onboarded_at)}</Row>
          </dl>
        </Panel>
        <Panel title="Bank details change">
          {pending ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-warn p-3 text-sm text-warn-foreground">
                <p className="font-semibold">Waiting for callback verification</p>
                <p>{mine ? "You" : `User #${pending.changed_by_user_id}`} asked on {formatDateTime(pending.changed_at)} (by {pending.request_channel?.replace(/_/g, " ")}) to change the account from •••• {pending.old_account_last4} to •••• {pending.new_account_last4}. The vendor's account stays as it is until someone calls the vendor on a number from the vendor file and confirms.</p>
              </div>
              {can(me.role, "bankVerify") ? (
                mine ? <p className="text-sm text-muted-foreground">You made this request, so someone else must verify it.</p> : (
                  <div className="flex flex-wrap gap-3">
                    <ConfirmInline label="Callback confirmed" confirmLabel="Yes, apply the change" pending={ver.isPending}
                      message={`Did the vendor confirm account •••• ${pending.new_account_last4} on a call?`}
                      onConfirm={() => ver.mutateAsync(true).then(done("Bank change applied")).catch(fail)} />
                    <ConfirmInline label="Not confirmed" variant="destructive" confirmLabel="Yes, reject it" pending={ver.isPending}
                      message="Reject this request and keep the current account?"
                      onConfirm={() => ver.mutateAsync(false).then(done("Bank change rejected")).catch(fail)} />
                  </div>
                )
              ) : <p className="text-sm text-muted-foreground">A finance manager or controller must verify this change.</p>}
            </div>
          ) : can(me.role, "bankChange") ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label htmlFor="inst">Institution</Label><Input id="inst" inputMode="numeric" maxLength={3} value={bank.institution} onChange={(e) => setBank({ ...bank, institution: e.target.value.replace(/\D/g, "") })} /></div>
                <div className="space-y-1.5"><Label htmlFor="tr">Transit</Label><Input id="tr" inputMode="numeric" maxLength={5} value={bank.transit} onChange={(e) => setBank({ ...bank, transit: e.target.value.replace(/\D/g, "") })} /></div>
                <div className="space-y-1.5"><Label htmlFor="acct">Account</Label><Input id="acct" inputMode="numeric" maxLength={12} value={bank.account} onChange={(e) => setBank({ ...bank, account: e.target.value.replace(/\D/g, "") })} /></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chan">How the request arrived</Label>
                <select id="chan" value={bank.channel} onChange={(e) => setBank({ ...bank, channel: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {CHANNELS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">3-digit institution, 5-digit transit, account number. Nothing changes until someone else confirms by phone.</p>
              <ConfirmInline label="Request bank change" confirmLabel="Submit request" pending={req.isPending}
                message={`Ask to change ${v.name}'s account to •••• ${bank.account.slice(-4) || "????"}?`}
                onConfirm={() => { if (!bankValid) { notify.error("Check the institution, transit and account numbers"); return; } req.mutateAsync(undefined).then(() => { notify.money("Bank change requested"); setBank({ ...bank, institution: "", transit: "", account: "" }); }).catch(fail); }} />
            </div>
          ) : <p className="text-sm text-muted-foreground">No pending bank changes.</p>}
        </Panel>
      </div>
      <h2 className="mt-10 mb-3 text-xl font-bold">Bank change history</h2>
      {v.bankChanges.length === 0 ? <p className="text-sm text-muted-foreground">No bank changes on record.</p> : (
        <Table>
          <thead><tr><Th>Requested</Th><Th>How</Th><Th>Account</Th><Th>Result</Th><Th>Decided</Th></tr></thead>
          <tbody>{[...v.bankChanges].reverse().map((c: BankChange) => (
            <tr key={c.id}>
              <Td className="num whitespace-nowrap">{formatDateTime(c.changed_at)}</Td>
              <Td>{c.request_channel?.replace(/_/g, " ") ?? "—"}</Td>
              <Td className="num">•••• {c.old_account_last4 ?? "?"} → •••• {c.new_account_last4 ?? "?"}</Td>
              <Td><StatusPill status={c.status} /></Td>
              <Td className="num whitespace-nowrap">{c.verified_at ? `${formatDateTime(c.verified_at)} by user #${c.verified_by_user_id}` : "—"}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </>
  );
}

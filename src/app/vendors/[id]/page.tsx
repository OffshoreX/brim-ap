"use client";
import { useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Table, ymd } from "@/components/ui";
import { Load, post } from "@/components/api";
import { ActionButton, ConfirmAction, useActions } from "@/components/actions";
import { CAN_CLERK, CAN_RELEASE, useCan, useCurrentUser } from "@/components/CurrentUser";

type Change = { id: number; changed_at: string; changed_by_user_id: number | null; request_channel: string | null; status: string; old_account_last4: string | null; new_account_last4: string | null; verified_by_user_id: number | null; verified_by_callback: number; verified_at: string | null };
type Vendor = { id: number; name: string; category: string | null; status: string | null; address: string | null; province_or_state: string | null; payment_terms_days: number | null; preferred_payment_method: string | null; bank_account_last4: string; bankChanges: Change[] };

// GET /api/vendors/{id}; POST /api/vendors/{id}/bank-change and /bank-change/verify.
export default function VendorPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [version, setVersion] = useState(0);
  // Hiding the buttons is for looks only: the server decides. The verify route allows finance_manager and controller_admin and refuses the requester.
  const { role } = useCurrentUser();
  const canVerify = useCan(CAN_RELEASE);
  const canRequest = useCan(CAN_CLERK);
  const a = useActions(() => setVersion((v) => v + 1)); // one request at a time; results stay at the bottom until dismissed
  const verify = (verified: boolean, key: string, ok: string) => a.run(key, () => post(`/api/vendors/${id}/bank-change/verify`, { verified }), ok);
  function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    a.run("request", () => post(`/api/vendors/${id}/bank-change`, f), "Bank change requested. Another user must verify it by callback.");
  }

  return (
    <main id="main">
      <h1>Vendor {id}</h1>
      <Load<Vendor> url={`/api/vendors/${id}?v=${version}`}>
        {(v) => {
          const acct = (c: Change) => [["Vendor", v.name], ["Account now", `…${c.old_account_last4}`], ["Account after", `…${c.new_account_last4}`]] as [string, string][];
          return (
          <>
            <Table><tbody>
              <tr><th>Name</th><td>{v.name}</td></tr><tr><th>Category</th><td>{v.category}</td></tr><tr><th>Status</th><td>{v.status}</td></tr>
              <tr><th>Address</th><td>{v.address}</td></tr><tr><th>Province</th><td>{v.province_or_state}</td></tr>
              <tr><th>Terms (days)</th><td>{v.payment_terms_days}</td></tr><tr><th>Preferred method</th><td>{v.preferred_payment_method}</td></tr>
              <tr><th>Bank account</th><td>…{v.bank_account_last4}</td></tr>
            </tbody></Table>
            <h2>Bank changes</h2>
            {role && !canVerify && v.bankChanges.some((c) => c.status === "pending") && <p className="muted">Only finance managers and controllers can verify a bank change.</p>}
            <Table>
              <thead><tr><th>When</th><th>Channel</th><th>Old</th><th>New</th><th>Status</th><th>Verified</th><th></th></tr></thead>
              <tbody>
                {v.bankChanges.map((c) => (
                  <tr key={c.id}>
                    <td>{ymd(c.changed_at)}</td><td>{c.request_channel}</td><td>…{c.old_account_last4}</td><td>…{c.new_account_last4}</td><td>{c.status}</td>
                    <td>{c.verified_by_callback ? `Yes, by user ${c.verified_by_user_id} on ${ymd(c.verified_at)}` : c.status === "rejected" ? `Rejected by user ${c.verified_by_user_id}` : "Not verified"}</td>
                    <td>
                      {canVerify && c.status === "pending" && (
                        <>
                          <ConfirmAction icon="approved" label="Callback confirmed" busyLabel="Applying…" ariaLabel={`Callback confirmed for ${v.name}, change …${c.old_account_last4} to …${c.new_account_last4}`} busy={a.busyKey === `verify-${c.id}`} locked={a.locked}
                            title="Confirm the callback" facts={acct(c)} confirmLabel={`Apply: pay ${v.name} to …${c.new_account_last4}`}
                            onConfirm={() => verify(true, `verify-${c.id}`, `Bank account for ${v.name} changed from …${c.old_account_last4} to …${c.new_account_last4}`)} />
                          <ConfirmAction secondary icon="rejected" label="Callback failed" busyLabel="Rejecting…" ariaLabel={`Callback failed for ${v.name}, reject change to …${c.new_account_last4}`} busy={a.busyKey === `reject-${c.id}`} locked={a.locked}
                            title="Reject the bank change" facts={acct(c)} confirmLabel={`Reject: keep paying …${c.old_account_last4}`}
                            onConfirm={() => verify(false, `reject-${c.id}`, `Bank change for ${v.name} rejected; payments still go to …${c.old_account_last4}`)} />
                          {a.show(`verify-${c.id}`)}{a.show(`reject-${c.id}`)}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
          );
        }}
      </Load>
      <h2>Request a bank change</h2>
      {role && !canRequest && <p className="muted">Only AP clerks, finance managers and controllers can request a bank change.</p>}
      {canRequest && <form onSubmit={request} className="inline">
        <input name="institution" placeholder="Institution" required aria-label="Institution" />
        <input name="transit" placeholder="Transit" required aria-label="Transit" />
        <input name="account" placeholder="Account number" required aria-label="Account number" />
        <input name="channel" placeholder="How was it requested? (email, phone…)" required aria-label="Request channel" />
        <ActionButton submit label="Request change" busyLabel="Requesting…" busy={a.busyKey === "request"} locked={a.locked} />
      </form>}
      {a.show("request")}
    </main>
  );
}

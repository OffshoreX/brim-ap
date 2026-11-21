"use client";
import { useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Load, Notice, post } from "@/components/api";

type Change = { id: number; changed_at: string; changed_by_user_id: number | null; request_channel: string | null; status: string; old_account_last4: string | null; new_account_last4: string | null; verified_by_user_id: number | null };
type Vendor = { id: number; name: string; category: string | null; status: string | null; address: string | null; province_or_state: string | null; payment_terms_days: number | null; preferred_payment_method: string | null; bank_account_last4: string; bankChanges: Change[] };

// GET /api/vendors/{id}; POST /api/vendors/{id}/bank-change and /bank-change/verify.
export default function VendorPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  async function act(url: string, body: unknown, done: string) {
    const r = await post(url, body);
    setMsg(r.error ? { error: r.error } : { ok: done });
    if (!r.error) setVersion((v) => v + 1);
  }
  function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    act(`/api/vendors/${id}/bank-change`, f, "Bank change requested. Another user must verify it by callback.");
  }

  return (
    <main>
      <h1>Vendor {id}</h1>
      <Load<Vendor> url={`/api/vendors/${id}?v=${version}`}>
        {(v) => (
          <>
            <table><tbody>
              <tr><th>Name</th><td>{v.name}</td></tr><tr><th>Category</th><td>{v.category}</td></tr><tr><th>Status</th><td>{v.status}</td></tr>
              <tr><th>Address</th><td>{v.address}</td></tr><tr><th>Province</th><td>{v.province_or_state}</td></tr>
              <tr><th>Terms (days)</th><td>{v.payment_terms_days}</td></tr><tr><th>Preferred method</th><td>{v.preferred_payment_method}</td></tr>
              <tr><th>Bank account</th><td>…{v.bank_account_last4}</td></tr>
            </tbody></table>
            <h2>Bank changes</h2>
            <table>
              <thead><tr><th>When</th><th>Channel</th><th>Old</th><th>New</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {v.bankChanges.map((c) => (
                  <tr key={c.id}>
                    <td>{c.changed_at}</td><td>{c.request_channel}</td><td>…{c.old_account_last4}</td><td>…{c.new_account_last4}</td><td>{c.status}</td>
                    <td>
                      {c.status === "pending" && (
                        <>
                          <button onClick={() => act(`/api/vendors/${id}/bank-change/verify`, { verified: true }, "Change verified and applied")}>Callback confirmed</button>
                          <button onClick={() => act(`/api/vendors/${id}/bank-change/verify`, { verified: false }, "Change rejected")}>Callback failed</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Load>
      <h2>Request a bank change</h2>
      <form onSubmit={request} className="inline">
        <input name="institution" placeholder="Institution" required aria-label="Institution" />
        <input name="transit" placeholder="Transit" required aria-label="Transit" />
        <input name="account" placeholder="Account number" required aria-label="Account number" />
        <input name="channel" placeholder="How was it requested? (email, phone…)" required aria-label="Request channel" />
        <button type="submit">Request change</button>
      </form>
      <Notice {...msg} />
    </main>
  );
}

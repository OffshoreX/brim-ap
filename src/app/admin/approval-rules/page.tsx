"use client";
import { useState } from "react";
import { Load, money, Notice, toCents, call } from "@/components/api";

type Rule = { id: number; policy_id: string | null; over_cents: number; extra_role: string };

function RuleRow({ rule, saved }: { rule: Rule; saved: () => void }) {
  const [text, setText] = useState(String(Math.floor(rule.over_cents / 100)));
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  async function save() {
    const cents = toCents(text);
    if (cents === null) return setMsg({ error: "Enter an amount like 5000 or 5000.50" });
    const r = await call(`/api/admin/approval-rules/${rule.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ over_cents: cents }) });
    if (r.error) setMsg({ error: r.error });
    else { setMsg({ ok: "Saved" }); saved(); }
  }
  return (
    <tr>
      <td>{rule.policy_id}</td><td>{rule.extra_role}</td><td className="num">{money(rule.over_cents, "CAD")}</td>
      <td>
        <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-label={`New threshold for ${rule.extra_role}`} />
        <button onClick={save}>Save</button>
        <Notice {...msg} />
      </td>
    </tr>
  );
}

// GET /api/admin/approval-rules, PUT /api/admin/approval-rules/{id} (the server checks the thresholds still rise).
export default function ApprovalRulesPage() {
  return (
    <main>
      <h1>Approval rules</h1>
      <p>An invoice over the amount gets an extra approval step by that role.</p>
      <Load<{ rules: Rule[] }> url="/api/admin/approval-rules">
        {({ rules }, reload) => (
          <table>
            <thead><tr><th>Policy</th><th>Extra approver</th><th className="num">Over (CAD)</th><th>Change to (dollars)</th></tr></thead>
            <tbody>{rules.map((r) => <RuleRow key={r.id} rule={r} saved={reload} />)}</tbody>
          </table>
        )}
      </Load>
    </main>
  );
}

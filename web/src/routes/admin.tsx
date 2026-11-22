import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction, useApprovalRules } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can, ROLE_LABEL } from "@/lib/roles";
import { pageHead } from "@/lib/seo";
import type { ApprovalRule, Role } from "@/lib/types";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => pageHead("Approval rules", "Who approves which invoices, by amount."),
  component: () => <AppShell>{(me) => (can(me.role, "admin") ? <AdminPage /> : <Forbidden />)}</AppShell>,
});

function AdminPage() {
  const q = useApprovalRules();
  return (
    <>
      <PageHeader title="Approval rules" subtitle="An invoice over each amount needs one more approver. Amounts are CAD; only the amount can be edited." />
      <QueryView q={q}>
        {(rules) => rules.length === 0 ? <Empty title="No rules defined" /> : (
          <Table>
            <thead><tr><Th>Policy</Th><Th>Invoice total over (CAD)</Th><Th>Extra approver</Th><Th /></tr></thead>
            <tbody>{rules.map((r) => <RuleRow key={r.id} r={r} />)}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

// "10000.50" -> 1000050. Whole cents only, as text, so no float ever reaches the server.
const toCents = (t: string) => (/^\d{1,10}(\.\d{1,2})?$/.test(t.trim()) ? Math.round(Number(t) * 100) : null);

function RuleRow({ r }: { r: ApprovalRule }) {
  const [amount, setAmount] = useState((r.over_cents / 100).toFixed(2));
  const cents = toCents(amount);
  // PUT /api/admin/approval-rules/:id { over_cents }. The server also refuses amounts that would make the levels fall.
  const save = useAction((c: number) => api.updateApprovalRule(r.id, c), [["approval-rules"], ["audit"]]);
  const dirty = cents !== r.over_cents;
  return (
    <tr>
      <Td className="font-semibold">{r.policy_id ?? `Rule ${r.id}`}</Td>
      <Td><Input aria-label={`Threshold for ${r.policy_id ?? r.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={cents === null} className="num h-9 w-40 text-right" /></Td>
      <Td>{r.extra_role === "cfo" ? "CFO" : ROLE_LABEL[r.extra_role as Role] ?? r.extra_role}</Td>
      <Td>{dirty && <Button disabled={cents === null || save.isPending} onClick={() => cents !== null && save.mutateAsync(cents).then(() => toast.success("Rule saved")).catch((e: Error) => { toast.error(e.message); setAmount((r.over_cents / 100).toFixed(2)); })}>{save.isPending ? "Saving…" : "Save"}</Button>}</Td>
    </tr>
  );
}

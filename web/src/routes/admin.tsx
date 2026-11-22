import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction, useApprovalRules } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can, ROLE_LABEL } from "@/lib/roles";
import { pageHead } from "@/lib/seo";
import type { ApprovalRule } from "@/lib/types";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => pageHead("Approval rules", "Who approves which invoices, by amount."),
  component: () => <AppShell>{(me) => (can(me.role, "admin") ? <AdminPage /> : <Forbidden />)}</AppShell>,
});

function AdminPage() {
  const q = useApprovalRules();
  return (
    <>
      <PageHeader title="Approval rules" subtitle="Amount bands decide who signs off and how many steps it takes." />
      <QueryView q={q}>
        {(rules) => rules.length === 0 ? <Empty title="No rules defined" /> : (
          <Table>
            <thead><tr><Th>Rule</Th><Th>Final approver</Th><Th right>From</Th><Th right>Up to</Th><Th center>Steps</Th><Th /></tr></thead>
            <tbody>{rules.map((r) => <RuleRow key={r.id} r={r} />)}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

function RuleRow({ r }: { r: ApprovalRule }) {
  const [steps, setSteps] = useState(String(r.steps));
  // PUT /api/admin/approval-rules/:id
  const save = useAction(() => api.updateApprovalRule(r.id, { ...r, steps: Number(steps) }), [["approval-rules"]]);
  const dirty = Number(steps) !== r.steps;
  return (
    <tr>
      <Td className="font-semibold">{r.name}</Td>
      <Td>{ROLE_LABEL[r.approverRole]}</Td>
      <Td right><Money cents={r.minCents} currency={r.currency} /></Td>
      <Td right>{r.maxCents === null ? "No limit" : <Money cents={r.maxCents} currency={r.currency} />}</Td>
      <Td center><Input aria-label={`Steps for ${r.name}`} type="number" min={1} max={5} value={steps} onChange={(e) => setSteps(e.target.value)} className="mx-auto h-9 w-20 text-center" /></Td>
      <Td>{dirty && <Button disabled={save.isPending} onClick={() => save.mutateAsync(undefined).then(() => toast.success("Rule saved")).catch((e: Error) => toast.error(e.message))}>{save.isPending ? "Saving…" : "Save"}</Button>}</Td>
    </tr>
  );
}

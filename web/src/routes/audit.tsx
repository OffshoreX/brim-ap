import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, XOctagon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { ErrorText } from "@/components/ErrorText";
import { Button } from "@/components/ui/button";
import { useAudit } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDateTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { Me } from "@/lib/types";

export const Route = createFileRoute("/audit")({
  ssr: false,
  head: () => pageHead("Audit log", "Tamper-evident log of every action, with chain verification."),
  component: () => <AppShell>{(me) => (can(me.role, "audit") ? <AuditPage me={me} /> : <Forbidden />)}</AppShell>,
});

function AuditPage({ me }: { me: Me }) {
  const q = useAudit();
  // GET /api/audit/verify
  const verify = useMutation({ mutationFn: api.auditVerify });
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every action, linked in a hash chain."
        actions={can(me.role, "auditVerify") && <Button disabled={verify.isPending} onClick={() => verify.mutate()}>{verify.isPending ? "Verifying…" : "Verify chain"}</Button>} />
      {verify.data && (
        <div role="status" className={`mb-6 flex items-center gap-2 rounded-xl p-4 font-semibold ${verify.data.ok ? "bg-ok text-ok-foreground" : "bg-bad text-bad-foreground"}`}>
          {verify.data.ok ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XOctagon className="h-5 w-5" aria-hidden />}
          {verify.data.ok ? "Pass" : "Fail"} — {verify.data.message}
        </div>
      )}
      <div className="mb-4"><ErrorText error={verify.error} /></div>
      <QueryView q={q}>
        {(rows) => rows.length === 0 ? <Empty title="No audit entries yet" /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>Hash</Th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><Td className="num whitespace-nowrap">{formatDateTime(r.at)}</Td><Td>{r.actorName}</Td><Td>{r.action.replace(/_/g, " ")}</Td><Td className="font-semibold">{r.entity}</Td><Td className="font-mono text-xs text-muted-foreground">{r.hash.slice(0, 12)}</Td></tr>)}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

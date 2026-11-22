import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Download, XOctagon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { ErrorText } from "@/components/ErrorText";
import { Button } from "@/components/ui/button";
import { useAudit } from "@/hooks/queries";
import { api, downloadUrl } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDateTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { Me } from "@/lib/types";

export const Route = createFileRoute("/audit")({
  ssr: false,
  head: () => pageHead("Audit log", "Tamper-evident log of every action, with chain verification."),
  component: () => <AppShell>{(me) => (can(me.role, "audit") ? <AuditPage me={me} /> : <Forbidden />)}</AppShell>,
});

const PAGE = 50;

function AuditPage({ me }: { me: Me }) {
  const [offset, setOffset] = useState(0);
  const q = useAudit({ limit: PAGE, offset });
  // GET /api/audit/verify: the server re-hashes every row and reports the first one that does not link up.
  const verify = useMutation({ mutationFn: api.auditVerify });
  const v = verify.data;
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every action, linked in a hash chain."
        actions={<div className="flex gap-2">
          <Button variant="outline" asChild><a href={downloadUrl("/audit?format=csv")} download><Download aria-hidden />CSV</a></Button>
          {can(me.role, "auditVerify") && <Button disabled={verify.isPending} onClick={() => verify.mutate()}>{verify.isPending ? "Verifying…" : "Verify chain"}</Button>}
        </div>} />
      {v && (
        <div role="status" className={`mb-6 flex items-start gap-2 rounded-xl p-4 font-semibold ${v.ok ? "bg-ok text-ok-foreground" : "bg-bad text-bad-foreground"}`}>
          {v.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> : <XOctagon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />}
          <div>
            {v.ok ? `Chain intact: ${v.rowCount.toLocaleString("en-CA")} entries checked.` : `Chain broken at entry #${v.brokenAtId} (${v.rowCount.toLocaleString("en-CA")} entries checked before it failed).`}
            <div className="text-sm font-normal">{v.ok ? <>Head hash <span className="font-mono">{v.headHash.slice(0, 16)}…</span></> : v.reason}</div>
          </div>
        </div>
      )}
      <div className="mb-4"><ErrorText error={verify.error} /></div>
      <QueryView q={q}>
        {({ items, total }) => items.length === 0 ? <Empty title="No audit entries yet" /> : (
          <>
            <Table>
              <thead><tr><Th>#</Th><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>Change</Th></tr></thead>
              <tbody>{items.map((r) => (
                <tr key={r.id}>
                  <Td className="num text-muted-foreground">{r.id}</Td>
                  <Td className="num whitespace-nowrap">{formatDateTime(r.at)}</Td>
                  <Td>{r.actorName}</Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td>{r.entity}{r.entityId ? ` #${r.entityId}` : ""}</Td>
                  <Td>
                    <details><summary className="cursor-pointer text-sm font-medium text-primary">Before and after</summary>
                      <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
                    </details>
                  </Td>
                </tr>
              ))}</tbody>
            </Table>
            <Pager offset={offset} limit={PAGE} total={total} onPage={setOffset} />
          </>
        )}
      </QueryView>
    </>
  );
}

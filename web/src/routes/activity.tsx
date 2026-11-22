import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { StatusPill } from "@/components/StatusPill";
import { useProcessLog } from "@/hooks/queries";
import { can } from "@/lib/roles";
import { formatDateTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/activity")({
  ssr: false,
  head: () => pageHead("Activity log", "Every automated processing step across all invoices."),
  component: () => <AppShell>{(me) => (can(me.role, "activity") ? <ActivityPage /> : <Forbidden />)}</AppShell>,
});

const words = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[_.]/g, " ");

function ActivityPage() {
  // GET /api/process-log?limit=200 (the server's maximum), newest first. Each row names its invoice.
  const q = useProcessLog(200);
  return (
    <>
      <PageHeader title="Activity log" subtitle="The latest 200 processing steps." />
      <QueryView q={q}>
        {(rows) => rows.length === 0 ? <Empty title="No activity yet" to="/upload" linkLabel="Upload an invoice" /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Invoice</Th><Th>Step</Th><Th>Detail</Th><Th>Result</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <Td className="num whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
                <Td>{r.invoiceId === undefined ? "—" : <Link to="/invoices/$id" params={{ id: String(r.invoiceId) }} className="font-semibold text-primary hover:underline">{r.invoiceNumber || `#${r.invoiceId}`}</Link>}</Td>
                <Td className="font-medium">{words(r.step)}</Td><Td className="text-sm">{r.detail}</Td>
                <Td><StatusPill status={r.status} /></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

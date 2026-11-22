import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { StatusPill } from "@/components/StatusPill";
import { useVendors } from "@/hooks/queries";
import { can } from "@/lib/roles";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/vendors/")({
  ssr: false,
  head: () => pageHead("Vendors", "Harborline vendors, payment methods and bank change status."),
  component: () => <AppShell>{(me) => (can(me.role, "vendors") ? <VendorsPage /> : <Forbidden />)}</AppShell>,
});

function VendorsPage() {
  const q = useVendors();
  return (
    <>
      <PageHeader title="Vendors" subtitle="Who Harborline pays and how." />
      <QueryView q={q}>
        {(vs) => vs.length === 0 ? <Empty title="No vendors yet" to="/upload" linkLabel="Upload an invoice">Vendors are created from invoices.</Empty> : (
          <Table>
            <thead><tr><Th>Vendor</Th><Th>Email</Th><Th>Pays by</Th><Th>Bank</Th><Th>Status</Th></tr></thead>
            <tbody>{vs.map((v) => (
              <tr key={v.id} className="hover:bg-muted/50">
                <Td><Link to="/vendors/$id" params={{ id: v.id }} className="font-semibold text-primary hover:underline">{v.name}</Link></Td>
                <Td>{v.email ?? "—"}</Td><Td>{v.paymentMethod.toUpperCase()}</Td>
                <Td className="num">{v.bankLast4 ? `•••• ${v.bankLast4}` : "—"}</Td>
                <Td><div className="flex flex-wrap gap-1.5"><StatusPill status={v.status} />{v.pendingBankChange && <StatusPill status="pending_verification" />}</div></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { StatusPill } from "@/components/StatusPill";
import { VendorForm } from "@/components/VendorForm";
import { Button } from "@/components/ui/button";
import { useVendors } from "@/hooks/queries";
import { can } from "@/lib/roles";
import { pageHead } from "@/lib/seo";
import type { Me } from "@/lib/types";

export const Route = createFileRoute("/vendors/")({
  ssr: false,
  head: () => pageHead("Vendors", "Harborline vendors, payment methods and bank change status."),
  component: () => <AppShell>{(me) => (can(me.role, "vendors") ? <VendorsPage me={me} /> : <Forbidden />)}</AppShell>,
});

function VendorsPage({ me }: { me: Me }) {
  const q = useVendors();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader title="Vendors" subtitle="Who Harborline pays and how."
        actions={can(me.role, "createVendor") && <Button onClick={() => setAdding(true)}>Add vendor</Button>} />
      {can(me.role, "createVendor") && <VendorForm open={adding} onOpenChange={setAdding} />}
      <QueryView q={q}>
        {(vs) => vs.length === 0 ? <Empty title="No vendors yet" to="/upload" linkLabel="Upload an invoice">Vendors are created from invoices.</Empty> : (
          <Table>
            <thead><tr><Th>Vendor</Th><Th>Category</Th><Th>Contact</Th><Th>Terms</Th><Th>Pays by</Th><Th>Bank</Th><Th>Status</Th></tr></thead>
            <tbody>{vs.map((v) => (
              <tr key={v.id} className="hover:bg-muted/50">
                <Td><Link to="/vendors/$id" params={{ id: String(v.id) }} className="font-semibold text-primary hover:underline">{v.name}</Link></Td>
                <Td>{v.category ?? "—"}</Td>
                <Td>{v.ap_contact_email ?? "—"}</Td>
                <Td>{v.payment_terms_days === null ? "—" : `Net ${v.payment_terms_days}`}</Td>
                <Td>{v.preferred_payment_method ?? "—"}</Td>
                <Td className="num">{v.bank_account_last4 ? `•••• ${v.bank_account_last4}` : "—"}</Td>
                <Td><StatusPill status={v.status} /></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

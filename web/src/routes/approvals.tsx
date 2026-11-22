import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { useAction, useApprovalsInbox } from "@/hooks/queries";
import { worstFlag } from "@/components/FlagBox";
import { api } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDate, plural } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { InboxItem, Me } from "@/lib/types";

export const Route = createFileRoute("/approvals")({
  ssr: false,
  head: () => pageHead("Approvals", "Invoices waiting for your approval."),
  component: () => <AppShell>{(me) => (can(me.role, "approvals") ? <ApprovalsPage /> : <Forbidden />)}</AppShell>,
});

function ApprovalsPage() {
  const q = useApprovalsInbox();
  return (
    <>
      <PageHeader title="Approvals" subtitle="Invoices routed to you. Blocked invoices must be resolved before approval." />
      <QueryView q={q}>
        {(items) => items.length === 0 ? <Empty title="You're all caught up" to="/invoices" linkLabel="Browse invoices">Nothing is waiting for your approval.</Empty> : (
          <Table>
            <thead><tr><Th>Vendor</Th><Th>Due</Th><Th right>Total</Th><Th right>Age</Th><Th>Flags</Th><Th>Why you</Th><Th /></tr></thead>
            <tbody>{items.map((i) => <InboxRow key={i.id} item={i} />)}</tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const approve = useAction(() => api.decide(item.id, "approve"), [["approvals"], ["invoice-counts"], ["invoices"]]);
  const blocking = worstFlag(item.flags) === "block";
  const top = item.flags[0];
  return (
    <tr className="hover:bg-muted/50">
      <Td><Link to="/invoices/$id" params={{ id: item.id }} className="font-semibold text-primary hover:underline">{item.vendorName}</Link><div className="text-xs text-muted-foreground">{item.invoiceNumber}</div></Td>
      <Td className="num whitespace-nowrap">{formatDate(item.dueDate)}</Td>
      <Td right><Money cents={item.totalCents} currency={item.currency} className="font-semibold" /></Td>
      <Td right>{item.ageDays} d</Td>
      <Td className="max-w-xs">{item.flags.length === 0 ? <span className="text-muted-foreground">None</span> : <span><span className={blocking ? "font-semibold text-bad-foreground" : "font-semibold text-warn-foreground"}>{plural(item.flags.length, "flag")}{blocking ? " · blocking" : ""}</span> <span className="text-sm">— {top?.reason}</span></span>}</Td>
      <Td className="text-sm">{item.whyYou}</Td>
      <Td>{blocking ? <Link to="/invoices/$id" params={{ id: item.id }} className="text-sm font-semibold text-primary hover:underline">Review</Link> :
        <Button disabled={approve.isPending} onClick={() => approve.mutateAsync(undefined).then(() => toast.success(`Approved ${item.invoiceNumber}`)).catch((e: Error) => toast.error(e.message))}>{approve.isPending ? "Approving…" : "Approve"}</Button>}</Td>
    </tr>
  );
}

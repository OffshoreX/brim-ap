import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { notify } from "@/lib/notify";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { Money } from "@/components/Money";
import { Pager } from "@/components/Pager";
import { Button } from "@/components/ui/button";
import { useAction, useApprovalsInbox } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDate, plural, NOT_READ_YET } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { InboxItem } from "@/lib/types";

export const Route = createFileRoute("/approvals")({
  ssr: false,
  head: () => pageHead("Approvals", "Invoices waiting for your approval."),
  component: () => <AppShell>{(me) => (can(me.role, "approvals") ? <ApprovalsPage /> : <Forbidden />)}</AppShell>,
});

const LIMIT = 25;

function ApprovalsPage() {
  const [offset, setOffset] = useState(0);
  // GET /api/approvals/inbox?limit=&offset= : only invoices where you are the next approver in the stored chain.
  const q = useApprovalsInbox({ limit: LIMIT, offset });
  return (
    <>
      <PageHeader title="Approvals" subtitle="Invoices routed to you. Blocked invoices must be resolved before approval." />
      <QueryView q={q}>
        {(d) => d.total === 0 ? <Empty title="You're all caught up" to="/invoices" linkLabel="Browse invoices">Nothing is waiting for your approval.</Empty> : (
          <>
            <Table>
              <thead><tr><Th>Vendor</Th><Th>Due</Th><Th right>Total</Th><Th right>Age</Th><Th>Flags</Th><Th>Why you</Th><Th /></tr></thead>
              <tbody>{d.items.map((i) => <InboxRow key={i.invoiceId} item={i} />)}</tbody>
            </Table>
            <Pager offset={offset} limit={LIMIT} total={d.total} onPage={setOffset} />
          </>
        )}
      </QueryView>
    </>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  // Approve moves the invoice toward payment: one click, the button locks while the call runs, and each click sends a new key.
  // A second approval (double click, two tabs) is refused by the server: the invoice is no longer waiting for this step.
  const approve = useAction(() => api.decide(item.invoiceId, "approved"), [["approvals"], ["invoices"], ["invoice-counts"], ["invoice", String(item.invoiceId)], ["dashboard"], ["payments"]]);
  const blocking = item.topFlag?.severity === "error";
  const id = String(item.invoiceId);
  return (
    <tr className="hover:bg-muted/50">
      <Td><Link to="/invoices/$id" params={{ id }} className="font-semibold text-primary hover:underline">{item.vendorName ?? NOT_READ_YET}</Link><div className="text-xs text-muted-foreground">{item.invoiceNumber || NOT_READ_YET}</div></Td>
      <Td className="num whitespace-nowrap">{formatDate(item.dueDate)}</Td>
      <Td right><Money cents={item.totalCents} currency={item.currency} className="font-semibold" /></Td>
      <Td right>{item.ageDays} d</Td>
      <Td className="max-w-xs">{item.flagCount === 0 || !item.topFlag ? <span className="text-muted-foreground">None</span> : <span><span className={blocking ? "font-semibold text-bad-foreground" : "font-semibold text-warn-foreground"}>{plural(item.flagCount, "flag")}{blocking ? " · blocking" : ""}</span> <span className="text-sm">— {item.topFlag.message}</span></span>}</Td>
      <Td className="text-sm">{item.reason}{item.delegatedFromId !== null && <span className="text-muted-foreground"> · delegated to you</span>}</Td>
      <Td>{blocking ? <Link to="/invoices/$id" params={{ id }} className="text-sm font-semibold text-primary hover:underline">Review</Link> :
        <Button disabled={approve.isPending} onClick={() => approve.mutateAsync(undefined).then(() => notify.money(`Approved ${item.invoiceNumber}`)).catch((e: Error) => notify.error(e.message))}>{approve.isPending ? "Approving…" : "Approve"}</Button>}</Td>
    </tr>
  );
}

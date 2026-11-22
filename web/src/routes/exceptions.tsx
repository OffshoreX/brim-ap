import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { FlagBox } from "@/components/FlagBox";
import { Money } from "@/components/Money";
import { ConfirmInline } from "@/components/ConfirmInline";
import { StatusPill } from "@/components/StatusPill";
import { Table, Th, Td } from "@/components/Table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction, useExceptions, useHistoricalExceptions, useOtherInbox } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { ExceptionItem, Me } from "@/lib/types";

export const Route = createFileRoute("/exceptions")({
  ssr: false,
  head: () => pageHead("Exceptions", "Flagged invoices that need a human decision."),
  component: () => <AppShell>{(me) => (can(me.role, "exceptionsHistory") ? <ExceptionsPage me={me} /> : <Forbidden />)}</AppShell>,
});

function ExceptionsPage({ me }: { me: Me }) {
  const canWork = can(me.role, "exceptions");
  const open = useExceptions();
  const hist = useHistoricalExceptions(true);
  const other = useOtherInbox(can(me.role, "importInbox") || me.role === "auditor");
  const importer = useAction(() => api.importInbox(), [["exceptions"], ["invoices"], ["invoice-counts"]]);

  return (
    <>
      <PageHeader title="Exceptions" subtitle="Every flag and its reason. Decide whether each invoice goes to approval."
        actions={can(me.role, "importInbox") && <Button variant="outline" disabled={importer.isPending} onClick={() => importer.mutateAsync(undefined).then((r) => toast.success(`Imported ${plural((r as { imported?: number })?.imported ?? 0, "invoice")} from the inbox`)).catch((e: Error) => toast.error(e.message))}>{importer.isPending ? "Importing…" : "Import from inbox"}</Button>} />
      {canWork && (
        <QueryView q={open}>
          {(items) => items.length === 0 ? <Empty title="No open exceptions" to="/invoices" linkLabel="Browse invoices">Flagged invoices will show up here.</Empty> : (
            <div className="grid gap-4 xl:grid-cols-2">{items.map((x) => <ExceptionCard key={x.id} item={x} />)}</div>
          )}
        </QueryView>
      )}
      <h2 className="mt-10 mb-3 text-xl font-bold">Resolved</h2>
      <QueryView q={hist}>
        {(h) => h.length === 0 ? <p className="text-sm text-muted-foreground">No resolved exceptions yet.</p> : (
          <Table>
            <thead><tr><Th>Invoice</Th><Th>Vendor</Th><Th>Outcome</Th><Th>By</Th><Th>When</Th><Th>Note</Th></tr></thead>
            <tbody>{h.map((r) => (
              <tr key={r.id}><Td className="font-semibold">{r.invoiceNumber}</Td><Td>{r.vendorName}</Td><Td><StatusPill status={r.resolution === "rejected" ? "rejected" : "pending_approval"} /></Td><Td>{r.resolvedBy}</Td><Td className="num">{formatDateTime(r.resolvedAt)}</Td><Td className="text-sm">{r.note ?? "—"}</Td></tr>
            ))}</tbody>
          </Table>
        )}
      </QueryView>
      {other.data && other.data.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-xl font-bold">Other inbox email</h2>
          <Table>
            <thead><tr><Th>From</Th><Th>Subject</Th><Th>Received</Th><Th>Why it wasn't imported</Th></tr></thead>
            <tbody>{other.data.map((e) => <tr key={e.id}><Td>{e.from}</Td><Td>{e.subject}</Td><Td className="num">{formatDateTime(e.receivedAt)}</Td><Td>{e.reason}</Td></tr>)}</tbody>
          </Table>
        </>
      )}
    </>
  );
}

function ExceptionCard({ item }: { item: ExceptionItem }) {
  const [note, setNote] = useState("");
  const resolve = useAction((a: "send_to_approval" | "reject") => api.resolveException(item.id, a, note), [["exceptions"], ["invoices"], ["invoice-counts"], ["approvals"]]);
  const go = (a: "send_to_approval" | "reject") => resolve.mutateAsync(a).then(() => toast.success(a === "reject" ? "Invoice rejected" : "Sent to approval")).catch((e: Error) => toast.error(e.message));
  const inv = item.invoice;
  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/invoices/$id" params={{ id: inv.id }} className="text-lg font-bold text-foreground hover:text-primary">{inv.vendorName}</Link>
          <p className="text-sm text-muted-foreground">{inv.invoiceNumber} · due <span className="num">{formatDate(inv.dueDate)}</span></p>
        </div>
        <Money cents={inv.totalCents} currency={inv.currency} className="text-xl font-bold" />
      </div>
      <FlagBox flags={item.flags} />
      <Textarea className="mt-4" placeholder="Note (why you're making this call)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={resolve.isPending} onClick={() => go("send_to_approval")}>{resolve.isPending ? "Saving…" : "Send to approval"}</Button>
        <ConfirmInline variant="destructive" label="Reject" confirmLabel="Reject invoice" pending={resolve.isPending} message={`Reject ${inv.invoiceNumber}?`} onConfirm={() => go("reject")} />
      </div>
    </Panel>
  );
}

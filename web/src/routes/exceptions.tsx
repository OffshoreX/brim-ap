import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { notify } from "@/lib/notify";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { FlagBox } from "@/components/FlagBox";
import { Money } from "@/components/Money";
import { ConfirmInline } from "@/components/ConfirmInline";
import { Pager } from "@/components/Pager";
import { Table, Th, Td } from "@/components/Table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction, useExceptions, useHistoricalExceptions, useOtherInbox } from "@/hooks/queries";
import { api } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDate, formatDateTime, plural, NOT_READ_YET } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import type { ExceptionRow, Me } from "@/lib/types";

export const Route = createFileRoute("/exceptions")({
  ssr: false,
  head: () => pageHead("Exceptions", "Flagged invoices that need a human decision."),
  component: () => <AppShell>{(me) => (can(me.role, "exceptionsHistory") ? <ExceptionsPage me={me} /> : <Forbidden />)}</AppShell>,
});

const LIMIT = 25;
const words = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[_.]/g, " ");
const REFRESH = [["exceptions"], ["invoices"], ["invoice-counts"], ["approvals"], ["dashboard"]];

function ExceptionsPage({ me }: { me: Me }) {
  const canWork = can(me.role, "exceptions");
  const canMail = can(me.role, "importInbox") || me.role === "auditor"; // the roles of GET /api/inbox/other
  const [openAt, setOpenAt] = useState(0);
  const [histAt, setHistAt] = useState(0);
  const [mailAt, setMailAt] = useState(0);
  const open = useExceptions({ limit: LIMIT, offset: openAt }, canWork);
  const hist = useHistoricalExceptions({ limit: LIMIT, offset: histAt });
  const other = useOtherInbox({ limit: LIMIT, offset: mailAt }, canMail);
  const importer = useAction(() => api.importInbox(), [...REFRESH, ["inbox-other"]]);
  const doImport = () => importer.mutateAsync(undefined)
    .then((r) => notify.info(`Imported ${plural(r.imported, "new invoice")} from the inbox${r.skipped ? ` (${plural(r.skipped, "email")} already imported)` : ""}`, r.imported ? { description: "They arrive as Received. Open each one and choose Run processing." } : {}))
    .catch((e: Error) => notify.error(e.message));

  return (
    <>
      <PageHeader title="Exceptions" subtitle="Every flag and its reason. Decide whether each invoice goes to approval."
        actions={can(me.role, "importInbox") && <Button variant="outline" disabled={importer.isPending} onClick={doImport}>{importer.isPending ? "Importing…" : "Import from inbox"}</Button>} />
      {canWork && (
        <QueryView q={open}>
          {(d) => d.total === 0 ? <Empty title="No open exceptions" to="/invoices" linkLabel="Browse invoices">Flagged invoices will show up here.</Empty> : (
            <>
              <div className="grid gap-4 xl:grid-cols-2">{d.items.map((x) => <ExceptionCard key={x.id} item={x} />)}</div>
              <Pager offset={openAt} limit={LIMIT} total={d.total} onPage={setOpenAt} />
            </>
          )}
        </QueryView>
      )}
      <h2 className="mt-10 mb-1 text-xl font-bold">Flagged history</h2>
      <p className="mb-3 text-sm text-muted-foreground">Problems found in past invoices and payments. Read-only: nothing here can be changed.</p>
      <QueryView q={hist}>
        {(d) => d.total === 0 ? <p className="text-sm text-muted-foreground">No flagged history.</p> : (
          <>
            <Table>
              <thead><tr><Th>Invoice</Th><Th>Finding</Th><Th>Why it was flagged</Th><Th>Payment</Th></tr></thead>
              <tbody>{d.items.map((r) => (
                <tr key={`${r.invoiceId}-${r.code}-${r.paymentId ?? ""}`}>
                  <Td><Link to="/invoices/$id" params={{ id: String(r.invoiceId) }} className="font-semibold text-primary hover:underline">{r.invoiceRef || NOT_READ_YET}</Link></Td>
                  <Td className="font-medium">{r.label}</Td><Td className="text-sm">{r.reason}</Td><Td className="num">{r.paymentId === null ? "—" : `#${r.paymentId}`}</Td>
                </tr>
              ))}</tbody>
            </Table>
            <Pager offset={histAt} limit={LIMIT} total={d.total} onPage={setHistAt} />
          </>
        )}
      </QueryView>
      {other.data && other.data.total > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-xl font-bold">Other inbox email</h2>
          <Table>
            <thead><tr><Th>From</Th><Th>Subject</Th><Th>Received</Th><Th>Type</Th><Th>Attachments</Th><Th>Notes</Th></tr></thead>
            <tbody>{other.data.items.map((e) => (
              <tr key={e.emailId}><Td>{e.from}</Td><Td>{e.subject}</Td><Td className="num whitespace-nowrap">{formatDateTime(e.receivedAt)}</Td><Td>{words(e.class)}</Td><Td className="num">{e.attachments.length}</Td><Td className="text-sm">{[...e.flags.map(words), ...(e.reason ? [e.reason] : [])].join("; ") || "—"}</Td></tr>
            ))}</tbody>
          </Table>
          <Pager offset={mailAt} limit={LIMIT} total={other.data.total} onPage={setMailAt} />
        </>
      )}
    </>
  );
}

function ExceptionCard({ item }: { item: ExceptionRow }) {
  const [note, setNote] = useState("");
  // One lock for both buttons: while a decision is in flight neither can be pressed, and a repeat is refused by the server (409).
  const resolve = useAction((a: "send_to_approval" | "reject") => api.resolveException(item.id, a, note), [...REFRESH, ["invoice", String(item.id)]]);
  const go = (a: "send_to_approval" | "reject") => resolve.mutateAsync(a).then(() => notify.money(a === "reject" ? "Invoice rejected" : "Sent to approval")).catch((e: Error) => notify.error(e.message));
  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/invoices/$id" params={{ id: String(item.id) }} className="text-lg font-bold text-foreground hover:text-primary">{item.vendorName ?? NOT_READ_YET}</Link>
          <p className="text-sm text-muted-foreground">{item.invoiceNumber || NOT_READ_YET} · due <span className="num">{formatDate(item.dueDate)}</span></p>
        </div>
        <Money cents={item.totalCents} currency={item.currency} className="text-xl font-bold" />
      </div>
      <FlagBox flags={item.flags} />
      <Textarea className="mt-4" placeholder="Note (why you're making this call)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={resolve.isPending} onClick={() => go("send_to_approval")}>{resolve.isPending ? "Saving…" : "Send to approval"}</Button>
        <ConfirmInline variant="destructive" label="Reject" confirmLabel="Reject invoice" pending={resolve.isPending} message={`Reject ${item.invoiceNumber}?`} onConfirm={() => go("reject")} />
      </div>
    </Panel>
  );
}

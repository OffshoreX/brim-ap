import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { notify } from "@/lib/notify";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { StatusPill } from "@/components/StatusPill";
import { Table, Th, Td } from "@/components/Table";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { useAction, useReconciliation } from "@/hooks/queries";
import { api, downloadUrl } from "@/lib/api";
import { can } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { RECON_CATEGORIES, type Me, type ReconCategory } from "@/lib/types";

export const Route = createFileRoute("/reconciliation")({
  ssr: false,
  head: () => pageHead("Reconciliation", "Match Brim card and bank activity to paid invoices."),
  component: () => <AppShell>{(me) => (can(me.role, "reconciliation") ? <ReconPage me={me} /> : <Forbidden />)}</AppShell>,
});

const LABEL: Record<ReconCategory, string> = {
  matched: "Matched",
  payment_unmatched: "Payment, no statement line",
  payment_ambiguous: "Payment, several lines fit",
  amount_diff: "Amount differs",
  duplicate: "Duplicate",
  bank_no_payment: "Bank line, no payment",
  card_no_payment: "Card charge, no payment",
};
// Pill colour per result (StatusPill keys): matched is good, the rest need someone to look.
const TONE: Record<ReconCategory, string> = { matched: "ok", payment_unmatched: "warn", payment_ambiguous: "warn", amount_diff: "warn", duplicate: "error", bank_no_payment: "warn", card_no_payment: "warn" };
const PAGE = 25;

function ReconPage({ me }: { me: Me }) {
  const [category, setCategory] = useState<ReconCategory | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const q = useReconciliation({ category, limit: PAGE, offset });
  // POST /api/reconciliation (saves each payment's status, one audit row per change)
  const run = useAction((_: void) => api.runReconciliation(), [["reconciliation"], ["audit"]]);
  const pick = (c: ReconCategory | undefined) => { setCategory(c); setOffset(0); };
  return (
    <>
      <PageHeader title="Reconciliation" subtitle="Payments matched against bank and card statements."
        actions={<div className="flex gap-2">
          <Button variant="outline" asChild><a href={downloadUrl(`/reconciliation?format=csv${category ? `&category=${category}` : ""}`)} download><Download aria-hidden />CSV</a></Button>
          {can(me.role, "runReconciliation") && <Button disabled={run.isPending} onClick={() => run.mutateAsync().then((r) => notify.info(`Reconciliation saved: ${r.changed} payment${r.changed === 1 ? "" : "s"} changed status`)).catch((e: Error) => notify.error(e.message))}>{run.isPending ? "Running…" : "Run reconciliation"}</Button>}
        </div>} />
      <QueryView q={q}>
        {(r) => (
          <>
            <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by result">
              <Button size="sm" variant={category === undefined ? "default" : "outline"} aria-pressed={category === undefined} onClick={() => pick(undefined)}>All ({RECON_CATEGORIES.reduce((n, c) => n + r.summary[c], 0).toLocaleString("en-CA")})</Button>
              {RECON_CATEGORIES.map((c) => <Button key={c} size="sm" variant={category === c ? "default" : "outline"} aria-pressed={category === c} onClick={() => pick(c)}>{LABEL[c]} ({r.summary[c].toLocaleString("en-CA")})</Button>)}
            </div>
            {r.rows.length === 0 ? <Empty title="Nothing in this group" /> : (
              <>
                <Table>
                  <thead><tr><Th>Result</Th><Th>Invoice</Th><Th>Method</Th><Th right>Payment</Th><Th>Statement line</Th><Th right>Line amount</Th><Th right>Difference</Th></tr></thead>
                  <tbody>{r.rows.map((x, k) => (
                    <tr key={`${x.paymentId ?? "none"}-${x.lineId ?? k}`}>
                      <Td><StatusPill status={TONE[x.category]} label={LABEL[x.category]} /></Td>
                      <Td>{x.invoiceNumber ? <><span className="font-semibold">{x.invoiceNumber}</span><div className="text-xs text-muted-foreground">{x.vendor}</div></> : "—"}</Td>
                      <Td>{x.method ?? "—"}</Td>
                      <Td right>{x.paymentCents === null ? "—" : <Money cents={x.paymentCents} currency="CAD" />}</Td>
                      <Td>{x.lineId ? <><span className="font-mono text-xs">{x.lineId}</span> <span className="text-muted-foreground">{formatDate(x.lineDate)}</span><div className="text-xs text-muted-foreground">{x.lineText}</div>{x.category !== "matched" && x.note && <div className="text-xs text-muted-foreground">{x.note}</div>}</> : <span className="text-xs text-muted-foreground">{x.note}</span>}</Td>
                      <Td right>{x.lineCents === null ? "—" : <Money cents={x.lineCents} currency="CAD" />}</Td>
                      <Td right>{x.diffCents === null ? "—" : <Money cents={x.diffCents} currency="CAD" />}</Td>
                    </tr>
                  ))}</tbody>
                </Table>
                <Pager offset={offset} limit={PAGE} total={r.total} onPage={setOffset} />
              </>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}

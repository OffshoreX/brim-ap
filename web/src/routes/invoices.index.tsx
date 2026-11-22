import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { StatusPill } from "@/components/StatusPill";
import { Money } from "@/components/Money";
import { Pager } from "@/components/Pager";
import { Button } from "@/components/ui/button";
import { useInvoices } from "@/hooks/queries";
import { formatDate, plural, NOT_READ_YET, RUN_PROCESSING_HINT } from "@/lib/format";
import { can } from "@/lib/roles";
import { pageHead } from "@/lib/seo";
import { cn } from "@/lib/utils";
import type { Me } from "@/lib/types";

const LIMIT = 25;
const TABS = [
  { value: "", label: "All" },
  { value: "received", label: "Received" },
  { value: "needs_review", label: "Needs review" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
];

export const Route = createFileRoute("/invoices/")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { status?: string | undefined; offset?: number | undefined } => ({
    status: typeof s["status"] === "string" && s["status"] ? s["status"] : undefined,
    offset: Number(s["offset"]) > 0 ? Number(s["offset"]) : undefined,
  }),
  head: () => pageHead("Invoices", "Every Harborline invoice, filterable by status."),
  component: () => <AppShell>{(me) => <InvoicesPage me={me} />}</AppShell>,
});

function InvoicesPage({ me }: { me: Me }) {
  const { status = "", offset = 0 } = Route.useSearch();
  const navigate = Route.useNavigate();
  // The status filter and paging are sent to the server (?status=&limit=&offset=); the total comes from X-Total-Count.
  // The server returns newest first.
  const q = useInvoices({ status: status || undefined, limit: LIMIT, offset });

  return (
    <>
      <PageHeader title="Invoices" subtitle={me.role === "employee" ? "Invoices you submitted." : "All invoices received by Harborline."}
        actions={can(me.role, "upload") && <Button asChild><Link to="/upload">Upload invoices</Link></Button>} />
      <div role="tablist" aria-label="Filter by status" className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.value} role="tab" aria-selected={status === t.value}
            onClick={() => navigate({ to: ".", search: { status: t.value || undefined } })}
            className={cn("min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors", status === t.value ? "border-primary bg-primary text-primary-foreground" : "glass text-foreground hover:border-primary/50")}>
            {t.label}
          </button>
        ))}
      </div>
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? (
          <Empty title="No invoices here" to={can(me.role, "upload") ? "/upload" : "/"} linkLabel={can(me.role, "upload") ? "Upload an invoice" : "Back to home"}>
            {status ? "Nothing with this status right now." : "Invoices appear once they're uploaded or imported."}
          </Empty>
        ) : (
          <>
            <Table>
              <thead><tr><Th>Invoice no.</Th><Th>Vendor</Th><Th>Date</Th><Th>Due</Th><Th>Status</Th><Th right>Total</Th></tr></thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/50">
                    <Td><Link to="/invoices/$id" params={{ id: String(i.id) }} className="font-semibold text-primary hover:underline">{i.invoiceNumber || NOT_READ_YET}</Link>
                      {!i.invoiceNumber && i.sourceFile && <div className="text-xs text-muted-foreground">{i.sourceFile.split("/").pop()}</div>} {/* the API sends a server path; show the file name only */}</Td>
                    <Td>{i.vendorName ?? (i.invoiceNumber ? "—" : <span className="text-muted-foreground">{RUN_PROCESSING_HINT}</span>)}</Td>
                    <Td className="num whitespace-nowrap">{formatDate(i.invoiceDate)}</Td>
                    <Td className="num whitespace-nowrap">{formatDate(i.dueDate)}</Td>
                    <Td><StatusPill status={i.status} />{i.flagCount ? <span className="ml-2 text-xs text-muted-foreground">{plural(i.flagCount, "flag")}</span> : null}</Td>
                    <Td right><Money cents={i.totalCents} currency={i.currency} className="font-semibold" /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager offset={offset} limit={LIMIT} total={d.total} onPage={(o) => navigate({ to: ".", search: (p) => ({ ...p, offset: o || undefined }) })} />
          </>
        )}
      </QueryView>
    </>
  );
}

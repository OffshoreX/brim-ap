import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { StatusPill } from "@/components/StatusPill";
import { Money } from "@/components/Money";
import { Pager } from "@/components/Pager";
import { Button } from "@/components/ui/button";
import { InvoiceFilterBar } from "@/components/InvoiceFilterBar";
import { useInvoices, useVendors } from "@/hooks/queries";
import { describeFilters, hasFilters, parseFilters, toApi, type InvoiceFilters } from "@/lib/invoiceFilters";
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
  validateSearch: (s: Record<string, unknown>): { status?: string | undefined; offset?: number | undefined } & InvoiceFilters => ({
    ...parseFilters(s),
    // keep a plain number as a number, or the router writes it back to the URL with quotes (min=%221000%22)
    ...(typeof s["min"] === "number" ? { min: s["min"] as unknown as string } : {}),
    ...(typeof s["max"] === "number" ? { max: s["max"] as unknown as string } : {}),
    status: typeof s["status"] === "string" && s["status"] ? s["status"] : undefined,
    offset: Number(s["offset"]) > 0 ? Number(s["offset"]) : undefined,
  }),
  head: () => pageHead("Invoices", "Every Harborline invoice, filterable by status."),
  component: () => <AppShell>{(me) => <InvoicesPage me={me} />}</AppShell>,
});

function InvoicesPage({ me }: { me: Me }) {
  const { status = "", offset = 0, ...raw } = Route.useSearch();
  const filters = parseFilters(raw); // min and max may arrive as numbers; this makes them text again
  const navigate = Route.useNavigate();
  // Status, filters and paging all live in the URL and are sent to the server (?status=&q=&vendorId=&...&limit=&offset=);
  // the matching total comes from X-Total-Count. Changing a filter goes back to the first page.
  const q = useInvoices({ status: status || undefined, ...toApi(filters), limit: LIMIT, offset });
  const vendorsQ = useVendors(can(me.role, "vendors")); // the vendor filter only exists for roles the server lets read vendors
  const vendors = can(me.role, "vendors") ? vendorsQ.data : undefined;
  const filtered = hasFilters(filters);
  // The router writes a text that looks like a number with quotes (min=%221000%22), so a plain amount goes into the URL as a number.
  const urlValue = (v: string | undefined) => (v !== undefined && String(Number(v)) === v ? (Number(v) as unknown as string) : v); // validateSearch turns it back into text
  const setFilters = (patch: Partial<InvoiceFilters>) => {
    const next = { ...patch };
    if ("min" in next) next.min = urlValue(next.min);
    if ("max" in next) next.max = urlValue(next.max);
    return navigate({ to: ".", search: (p) => ({ ...p, ...next, offset: undefined }) });
  };
  const clear = () => navigate({ to: ".", search: (p) => ({ status: p.status }) });

  return (
    <>
      <PageHeader title="Invoices" subtitle={me.role === "employee" ? "Invoices you submitted." : "All invoices received by Harborline."}
        actions={can(me.role, "upload") && <Button asChild><Link to="/upload">Upload invoices</Link></Button>} />
      <div role="tablist" aria-label="Filter by status" className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.value} role="tab" aria-selected={status === t.value}
            onClick={() => navigate({ to: ".", search: (p) => ({ ...p, status: t.value || undefined, offset: undefined }) })} // keeps the filters
            className={cn("min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors", status === t.value ? "border-primary bg-primary text-primary-foreground" : "glass text-foreground hover:border-primary/50")}>
            {t.label}
          </button>
        ))}
      </div>
      <InvoiceFilterBar filters={filters} vendors={vendors} onChange={setFilters} onClear={clear} />
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? (
          <Empty title={filtered ? "No invoices match" : "No invoices here"} to={can(me.role, "upload") ? "/upload" : "/"} linkLabel={can(me.role, "upload") ? "Upload an invoice" : "Back to home"}>
            {filtered
              ? `Nothing matches ${[...(status ? [`status ${TABS.find((t) => t.value === status)?.label ?? status}`] : []), ...describeFilters(filters, vendors?.find((v) => v.id === filters.vendor)?.name)].join(", ")}. Try clearing a filter.`
              : status ? "Nothing with this status right now." : "Invoices appear once they're uploaded or imported."}
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
            <Pager matching offset={offset} limit={LIMIT} total={d.total} onPage={(o) => navigate({ to: ".", search: (p) => ({ ...p, offset: o || undefined }) })} />
          </>
        )}
      </QueryView>
    </>
  );
}

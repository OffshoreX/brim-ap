import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dollarsToCents, hasFilters, SORTS, type InvoiceFilters } from "@/lib/invoiceFilters";
import type { Vendor } from "@/lib/types";
import { cn } from "@/lib/utils";

// A text box that tells the page about a change only after 300 ms of no typing, so the server is asked once, not per key.
function DebouncedInput({ value, onCommit, ...props }: { value: string; onCommit: (v: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  useEffect(() => { if (value !== sent.current) { sent.current = value; setText(value); } }, [value]); // changed from outside, e.g. Clear filters
  useEffect(() => {
    if (text === sent.current) return;
    const t = setTimeout(() => { sent.current = text; onCommit(text); }, 300);
    return () => clearTimeout(t);
  }, [text, onCommit]);
  return <Input {...props} value={text} onChange={(e) => setText(e.target.value)} />;
}

function VendorPicker({ vendors, value, onChange }: { vendors: Vendor[]; value: number | undefined; onChange: (id: number | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const chosen = vendors.find((v) => v.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id="f-vendor" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate">{chosen?.name ?? (value ? `Vendor #${value}` : "All vendors")}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search vendors" />
          <CommandList>
            <CommandEmpty>No vendor matches.</CommandEmpty>
            <CommandItem value="all vendors" onSelect={() => { onChange(undefined); setOpen(false); }}>All vendors</CommandItem>
            {vendors.map((v) => (
              <CommandItem key={v.id} value={`${v.name} ${v.id}`} onSelect={() => { onChange(v.id); setOpen(false); }}>
                <Check className={cn("mr-2 size-4", v.id === value ? "opacity-100" : "opacity-0")} />{v.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const Field = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
  <div className="min-w-0 space-y-1"><Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>{children}</div>
);

export function InvoiceFilterBar({ filters, vendors, onChange, onClear }: {
  filters: InvoiceFilters;
  vendors: Vendor[] | undefined; // undefined = this role cannot read vendors, so there is no vendor filter
  onChange: (patch: Partial<InvoiceFilters>) => void;
  onClear: () => void;
}) {
  const amount = (k: "min" | "max", label: string) => {
    const bad = !!filters[k] && dollarsToCents(filters[k]) === undefined;
    return (
      <Field id={`f-${k}`} label={label}>
        <DebouncedInput id={`f-${k}`} inputMode="decimal" placeholder="0.00" value={filters[k] ?? ""} aria-invalid={bad} title={bad ? "Use dollars and cents, like 1250.00" : undefined}
          className={bad ? "border-destructive" : undefined} onCommit={(v) => onChange({ [k]: v.trim() || undefined })} />
      </Field>
    );
  };
  const day = (k: "from" | "to" | "dueFrom" | "dueTo", label: string) => (
    <Field id={`f-${k}`} label={label}>
      <Input id={`f-${k}`} type="date" value={filters[k] ?? ""} onChange={(e) => onChange({ [k]: e.target.value || undefined })} />
    </Field>
  );
  return (
    <div className="glass mb-4 space-y-3 rounded-xl border p-3" role="search" aria-label="Search and filter invoices">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Label htmlFor="f-q" className="sr-only">Search by invoice number or vendor</Label>
          <DebouncedInput id="f-q" type="search" placeholder="Search invoice number or vendor" maxLength={100} value={filters.q ?? ""} onCommit={(v) => onChange({ q: v.trim() || undefined })} />
        </div>
        <Field id="f-sort" label="Sort">
          <select id="f-sort" value={filters.sort ?? "newest"} onChange={(e) => onChange({ sort: e.target.value })}
            className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Button variant="outline" disabled={!hasFilters(filters)} onClick={onClear}>Clear filters</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {vendors && <Field id="f-vendor" label="Vendor"><VendorPicker vendors={vendors} value={filters.vendor} onChange={(vendor) => onChange({ vendor })} /></Field>}
        {amount("min", "Amount from ($)")}
        {amount("max", "Amount to ($)")}
        {day("from", "Invoice date from")}
        {day("to", "Invoice date to")}
        {day("dueFrom", "Due from")}
        {day("dueTo", "Due to")}
      </div>
    </div>
  );
}

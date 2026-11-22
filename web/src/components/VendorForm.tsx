import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorText } from "@/components/ErrorText";
import { useAction } from "@/hooks/queries";
import { api, errorText } from "@/lib/api";
import { EMPTY, fieldOfError, TEXT, vendorBody, type Form } from "@/lib/vendorForm";
import type { NewVendor } from "@/lib/types";

const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export function VendorForm({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const create = useAction((b: NewVendor) => api.createVendor(b), [["vendors"], ["audit"]]);
  const at = error ? fieldOfError(error) : null;
  const set = (k: keyof Form, v: string | boolean) => setF({ ...f, [k]: v });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutateAsync(vendorBody(f)).then((v) => {
      notify.info(`${v.name} added. It is pending review until someone else approves it.`);
      setF(EMPTY);
      onOpenChange(false);
      void navigate({ to: "/vendors/$id", params: { id: String(v.id) } });
    }).catch((err: Error) => setError(errorText(err)));
  };

  // One labelled box; the server's message for that field shows under it.
  const field = (k: string, label: string, control: ReactNode) => (
    <div className="space-y-1.5">
      <Label htmlFor={`v-${k}`}>{label}</Label>
      {control}
      {at === k && <p id={`v-${k}-err`} role="alert" className="text-sm font-medium text-bad-foreground">{error}</p>}
    </div>
  );
  const text = (k: (typeof TEXT)[number], label: string, hint?: string) =>
    field(k, label, <Input id={`v-${k}`} value={f[k]} placeholder={hint} aria-invalid={at === k} aria-describedby={at === k ? `v-${k}-err` : undefined} onChange={(e) => set(k, e.target.value)} />);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add vendor</SheetTitle>
          <SheetDescription>The vendor starts as pending review with no bank details. A finance manager or controller other than you approves it; bank details come later through a verified bank change.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {text("name", "Name")}
          <div className="grid gap-4 sm:grid-cols-2">
            {text("category", "Category")}
            {text("ap_contact_email", "AP contact email")}
            {text("province_or_state", "Province or state")}
            {field("country", "Country", (
              <select id="v-country" value={f.country} onChange={(e) => set("country", e.target.value)} className={selectCls} aria-invalid={at === "country"}>
                <option value="">Not set</option><option value="CA">CA</option><option value="US">US</option>
              </select>
            ))}
            {text("gst_hst_number", "GST/HST number", "123456789RT0001")}
            {text("qst_number", "QST number", "1234567890TQ0001")}
            {field("payment_terms_days", "Payment terms (days)", <Input id="v-payment_terms_days" inputMode="numeric" value={f.payment_terms_days} aria-invalid={at === "payment_terms_days"} onChange={(e) => set("payment_terms_days", e.target.value)} />)}
            {field("preferred_payment_method", "Pays by", (
              <select id="v-preferred_payment_method" value={f.preferred_payment_method} onChange={(e) => set("preferred_payment_method", e.target.value)} className={selectCls} aria-invalid={at === "preferred_payment_method"}>
                <option value="">Not set</option><option value="EFT">EFT</option><option value="CHEQUE">Cheque</option><option value="CARD">Card</option>
              </select>
            ))}
            {text("default_gl_account", "Default GL account", "6110")}
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={f.requires_po} onChange={(e) => set("requires_po", e.target.checked)} className="h-4 w-4" />
            Invoices from this vendor need a purchase order
          </label>
          {at === null && <ErrorText error={error} />}
          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Adding…" : "Add vendor"}</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

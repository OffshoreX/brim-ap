import { useState } from "react";
import { Download } from "lucide-react";
import { ErrorText } from "@/components/ErrorText";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

// Same three roles as the Reports page (finance manager, controller, auditor), so the page's own role check covers this panel.
// It fetches the file itself (not a plain link) so a refusal from the server, such as a bad date range, is shown as text
// and not saved as a file.
export function JournalExport() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const csv = await api.exportJournal(from, to);
      const name = `journal-${from}-to-${to}.csv`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 0);
      setSaved(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Export journal" className="mt-6">
      <p className="mb-4 text-sm text-muted-foreground">Approved, scheduled and paid invoices dated in the range (both days included), as balanced double entries for the accounting system.</p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5"><Label htmlFor="j-from">From</Label><Input id="j-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
        <div className="space-y-1.5"><Label htmlFor="j-to">To</Label><Input id="j-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
        <Button onClick={() => void download()} disabled={busy || !from || !to}><Download aria-hidden />{busy ? "Preparing…" : "Download CSV"}</Button>
      </div>
      <div className="mt-3"><ErrorText error={error} />{saved && <p role="status" className="text-sm text-muted-foreground">Saved {saved}</p>}</div>
    </Panel>
  );
}

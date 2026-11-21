import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

// Looks only. Colour AND a text label AND an icon so meaning never depends on colour alone.
export const STATUS_LABEL: Record<string, string> = {
  received: "Received", needs_review: "Needs review", pending_approval: "Pending approval", approved: "Approved",
  scheduled: "Scheduled", paid: "Paid", rejected: "Rejected",
};
// A status the UI does not know gets a neutral grey badge and a plain label ("part_paid" -> "Part paid"), never the raw code.
const plain = (s: string) => { const t = s.replace(/_/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : "Unknown"; };
// `label` is the plain text the API already sent (payments carry statusLabel); "settled" is the payment word for money moved, drawn as Paid.
const ALIAS: Record<string, string> = { settled: "paid" };
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const key = ALIAS[status] ?? status;
  const known = key in STATUS_LABEL;
  return <span className={`badge ${known ? `badge-${key}` : "badge-unknown"}`}>{known && <Icon name={key as IconName} />}{label ?? (known ? STATUS_LABEL[key] : plain(status))}</span>;
}

const SEVERITY: Record<string, string> = { error: "Error", warning: "Warning", info: "Info" };
export function SeverityChip({ severity = "info" }: { severity?: string }) {
  const known = severity in SEVERITY ? severity : "info";
  return <span className={`chip chip-${known}`}><Icon name={known as IconName} />{SEVERITY[known]}</span>;
}

// Scrolls sideways on phones and keyboard-focusable so it can be scrolled without a mouse; the header row sticks.
export const Table = ({ children }: { children: ReactNode }) => (
  <div className="table-wrap" tabIndex={0} role="region" aria-label="Table, scrolls sideways on narrow screens"><table>{children}</table></div>
);

// One helpful sentence, plus a link to the next step when there is one.
export const Empty = ({ children, href, next }: { children: ReactNode; href?: string; next?: string }) => (
  <p className="empty">{children}{href && next && <> <Link href={href}>{next} →</Link></>}</p>
);

// Grey placeholder rows shown while a request is in flight.
export const Skeleton = ({ rows = 4 }: { rows?: number }) => (
  <div className="skeleton" role="status" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton-row" />)}
  </div>
);

// Dates are shown as YYYY-MM-DD (and HH:MM for timestamps) everywhere; the server already sends ISO text.
export const ymd = (s: string | null | undefined) => (s ? s.slice(0, 10) : "—");
export const stamp = (s: string | null | undefined) => (s ? s.replace("T", " ").slice(0, 16) : "—");


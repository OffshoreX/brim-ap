import type { ReactNode } from "react";

// Looks only. Colour AND a text label (and an icon glyph) so meaning never depends on colour alone.
const STATUS_LABEL: Record<string, string> = {
  received: "Received", needs_review: "Needs review", pending_approval: "Pending approval", approved: "Approved",
  scheduled: "Scheduled", paid: "Paid", rejected: "Rejected",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

const SEVERITY: Record<string, string> = { error: "✖ Error", warning: "▲ Warning", info: "ℹ Info" };
export function SeverityChip({ severity = "info" }: { severity?: string }) {
  const known = severity in SEVERITY ? severity : "info";
  return <span className={`chip chip-${known}`}>{SEVERITY[known]}</span>;
}

// Scrolls sideways on phones; the header row sticks while the table scrolls vertically.
export const Table = ({ children }: { children: ReactNode }) => (
  <div className="table-wrap"><table>{children}</table></div>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;

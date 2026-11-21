import { Table, stamp } from "./ui";
import { humanise } from "./labels";

export type AuditRow = { id: number; at: string; actorId: number | null; actorName?: string | null; action: string; entity?: string; entityId?: string | null; before: unknown; after: unknown };

// One line for a before/after value: "status: needs_review, total: 100", cut at 60 characters. The full JSON sits in the row's expander.
export function summarise(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const text = typeof v === "object" ? Object.entries(v as object).map(([k, x]) => `${humanise(k).toLowerCase()}: ${typeof x === "object" && x !== null ? "…" : /^[a-z]+(_[a-z]+)+$/.test(String(x)) ? humanise(String(x)).toLowerCase() : String(x)}`).join(", ") : String(v);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text || "—";
}

// Shared by the audit log and the invoice trail. actorName comes from the server; no actor means the system did it.
export function AuditTable({ rows, entity }: { rows: AuditRow[]; entity?: boolean }) {
  return (
    <Table>
      <thead><tr><th>When</th><th>Who</th><th>What</th>{entity && <th>Entity</th>}<th>Change</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{stamp(r.at)}</td><td>{r.actorName ?? (r.actorId === null ? "System" : `User ${r.actorId}`)}</td><td>{humanise(r.action)}</td>
            {entity && <td>{humanise(r.entity)} {r.entityId}</td>}
            <td>
              <details>
                <summary>{summarise(r.before)} → {summarise(r.after)}</summary>
                <pre>Before: {JSON.stringify(r.before, null, 2)}{"\n"}After: {JSON.stringify(r.after, null, 2)}</pre>
              </details>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";

export class CodingError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

export type CodingPatch = { glAccount?: string; taxCode?: string; departmentId?: number };
type LineRow = { id: number; invoice_id: number; gl: string | null; tax: string | null; department_id: number | null; coding_needed: number; coding_source: string | null; status: string };

// Role is checked by the route (requireRole). One transaction: the update and its audit row land together.
export function setLineCoding(user: User, invoiceId: number, lineId: number, patch: CodingPatch) {
  const db = getDb();
  return db.transaction(() => {
    const line = db
      .prepare(
        `SELECT l.id, l.invoice_id, g.code AS gl, t.code AS tax, l.department_id, l.coding_needed, l.coding_source, i.status
         FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
         LEFT JOIN gl_accounts g ON g.id = l.gl_account_id LEFT JOIN tax_codes t ON t.id = l.tax_code_id
         WHERE l.id = ? AND l.invoice_id = ?`
      )
      .get(lineId, invoiceId) as LineRow | undefined;
    if (!line) throw new CodingError(404, "Line not found");
    // Once approved the books have moved on; coding is fixed before the decision.
    if (line.status !== "needs_review" && line.status !== "pending_approval") throw new CodingError(409, `Invoice is ${line.status}; coding can no longer change`);

    const gl = patch.glAccount === undefined ? undefined : (db.prepare("SELECT id FROM gl_accounts WHERE code = ?").get(patch.glAccount) as { id: number } | undefined);
    if (patch.glAccount !== undefined && !gl) throw new CodingError(400, `Unknown GL account ${patch.glAccount}`);
    const tax = patch.taxCode === undefined ? undefined : (db.prepare("SELECT id FROM tax_codes WHERE code = ?").get(patch.taxCode) as { id: number } | undefined);
    if (patch.taxCode !== undefined && !tax) throw new CodingError(400, `Unknown tax code ${patch.taxCode}`);
    if (patch.departmentId !== undefined && !db.prepare("SELECT 1 FROM departments WHERE id = ?").get(patch.departmentId)) throw new CodingError(400, `Unknown department ${patch.departmentId}`);
    if (!gl && !tax && patch.departmentId === undefined) throw new CodingError(400, "Nothing to change");

    const reason = `set by user ${user.id}`;
    db.prepare(
      `UPDATE invoice_lines SET gl_account_id = COALESCE(?, gl_account_id), tax_code_id = COALESCE(?, tax_code_id), department_id = COALESCE(?, department_id),
       coding_source = 'manual', coding_reason = ?, coding_needed = CASE WHEN COALESCE(?, gl_account_id) IS NULL THEN 1 ELSE 0 END WHERE id = ?`
    ).run(gl?.id ?? null, tax?.id ?? null, patch.departmentId ?? null, reason, gl?.id ?? null, lineId);

    const after = { glAccount: patch.glAccount ?? line.gl, taxCode: patch.taxCode ?? line.tax, departmentId: patch.departmentId ?? line.department_id, codingNeeded: false, source: "manual" };
    writeAudit({
      actorId: user.id, action: "invoice_line.coding_set", entity: "invoice_line", entityId: lineId,
      before: { invoiceId, glAccount: line.gl, taxCode: line.tax, departmentId: line.department_id, codingNeeded: line.coding_needed === 1, source: line.coding_source },
      after: { invoiceId, ...after },
    });
    return { lineId, ...after };
  })();
}

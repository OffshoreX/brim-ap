// Vendor master + the bank-change workflow. Roles are checked in the routes (requireRole);
// the "different person verifies" rule lives here because it needs the request row.
import { getDb } from "./db";
import { writeAudit } from "./audit";
import type { User } from "@/contracts";

export class VendorError extends Error {
  constructor(public status: 400 | 404 | 403 | 409, message: string) {
    super(message);
  }
}

// Non-bank fields a clerk may edit. Bank fields are deliberately absent: they only change via verify.
const EDITABLE = ["name", "category", "default_gl_account", "address", "province_or_state", "country", "gst_hst_number", "qst_number", "payment_terms_days", "early_pay_discount", "preferred_payment_method", "accepts_card_payment", "ap_contact_email", "requires_po", "status"] as const;

// Never send the full account number to the browser: last 4 only.
const last4 = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-4);
type Row = Record<string, unknown> & { id: number; bank_account: string | null };
const shape = ({ bank_account, ...v }: Row) => ({ ...v, bank_account_last4: last4(bank_account) });

export const listVendors = () => (getDb().prepare("SELECT * FROM vendors ORDER BY name").all() as Row[]).map(shape);

export function getVendor(id: number) {
  const db = getDb();
  const v = db.prepare("SELECT * FROM vendors WHERE id = ?").get(id) as Row | undefined;
  if (!v) throw new VendorError(404, "Vendor not found");
  const bankChanges = db
    .prepare(
      `SELECT id, changed_at, changed_by_user_id, request_channel, status, verified_by_callback,
              old_account_last4, new_account_last4, verified_by_user_id, verified_at
       FROM vendor_bank_changes WHERE vendor_id = ? ORDER BY changed_at, id`
    )
    .all(id);
  return { ...shape(v), bankChanges };
}

export function updateVendor(user: User, id: number, patch: Record<string, unknown>) {
  const db = getDb();
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new VendorError(400, "Nothing to update");
  const bad = keys.filter((k) => !(EDITABLE as readonly string[]).includes(k));
  if (bad.length) throw new VendorError(400, `Not editable here: ${bad.join(", ")}`); // bank_* lands here
  return db.transaction(() => {
    const before = db.prepare("SELECT * FROM vendors WHERE id = ?").get(id) as Row | undefined;
    if (!before) throw new VendorError(404, "Vendor not found");
    try {
      db.prepare(`UPDATE vendors SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k] as never), id);
    } catch (e) {
      if (e instanceof TypeError || (e as { code?: string }).code?.startsWith("SQLITE_")) throw new VendorError(400, "Invalid value");
      throw e;
    }
    writeAudit({
      actorId: user.id, action: "vendor.update", entity: "vendor", entityId: id,
      before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: Object.fromEntries(keys.map((k) => [k, patch[k]])),
    });
    return getVendor(id);
  })();
}

// Creates a pending request. Nothing on the vendor master changes yet.
export function requestBankChange(user: User, id: number, b: { institution?: unknown; transit?: unknown; account?: unknown; channel?: unknown }) {
  const { institution, transit, account, channel } = b;
  if (![institution, transit, account, channel].every((x) => typeof x === "string" && x.trim() !== ""))
    throw new VendorError(400, "institution, transit, account and channel are required strings");
  if (last4(account as string).length !== 4) throw new VendorError(400, "account must have at least 4 digits");
  const db = getDb();
  return db.transaction(() => {
    const v = db.prepare("SELECT bank_account FROM vendors WHERE id = ?").get(id) as { bank_account: string | null } | undefined;
    if (!v) throw new VendorError(404, "Vendor not found");
    if (db.prepare("SELECT 1 FROM vendor_bank_changes WHERE vendor_id = ? AND status = 'pending'").get(id))
      throw new VendorError(409, "A bank change is already pending for this vendor");
    const row = {
      vendor_id: id, changed_by_user_id: user.id, request_channel: (channel as string).trim(),
      old_account_last4: last4(v.bank_account), new_account_last4: last4(account as string),
    };
    const rid = db
      .prepare(
        `INSERT INTO vendor_bank_changes (vendor_id, changed_at, changed_by_user_id, request_channel, verified_by_callback, old_account_last4, new_account_last4, status, new_bank_institution, new_bank_transit, new_bank_account)
         VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?, 0, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(id, user.id, row.request_channel, row.old_account_last4, row.new_account_last4, (institution as string).trim(), (transit as string).trim(), (account as string).trim()).lastInsertRowid;
    writeAudit({ actorId: user.id, action: "vendor.bank_change_requested", entity: "vendor_bank_change", entityId: Number(rid), after: { vendorId: id, ...row, status: "pending" } });
    return { id: Number(rid), vendorId: id, status: "pending", oldLast4: row.old_account_last4, newLast4: row.new_account_last4 };
  })();
}

// Callback result. verified=true applies the change; verified=false marks it rejected and leaves the master alone.
export function verifyBankChange(user: User, vendorId: number, verified: boolean) {
  const db = getDb();
  return db.transaction(() => {
    const req = db.prepare("SELECT * FROM vendor_bank_changes WHERE vendor_id = ? AND status = 'pending'").get(vendorId) as
      | { id: number; changed_by_user_id: number; new_bank_institution: string; new_bank_transit: string; new_bank_account: string; old_account_last4: string; new_account_last4: string }
      | undefined;
    if (!req) throw new VendorError(404, "No pending bank change for this vendor");
    // Separation of duties: the person who asked cannot be the person who confirms.
    if (req.changed_by_user_id === user.id) throw new VendorError(403, "You cannot verify your own bank-change request");
    if (!verified) {
      db.prepare("UPDATE vendor_bank_changes SET status='rejected', verified_by_user_id=?, verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(user.id, req.id);
      writeAudit({ actorId: user.id, action: "vendor.bank_change_rejected", entity: "vendor_bank_change", entityId: req.id, before: { status: "pending" }, after: { status: "rejected", vendorId } });
      return { id: req.id, vendorId, status: "rejected" as const };
    }
    db.prepare("UPDATE vendors SET bank_institution=?, bank_transit=?, bank_account=?, bank_details_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(
      req.new_bank_institution, req.new_bank_transit, req.new_bank_account, vendorId
    );
    db.prepare("UPDATE vendor_bank_changes SET status='applied', verified_by_callback=1, verified_by_user_id=?, verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(user.id, req.id);
    writeAudit({
      actorId: user.id, action: "vendor.bank_change_verified", entity: "vendor_bank_change", entityId: req.id,
      before: { status: "pending", oldLast4: req.old_account_last4 }, after: { status: "applied", newLast4: req.new_account_last4, vendorId },
    });
    // Master change audited separately, last4 only so the full account never lands in the log.
    writeAudit({ actorId: user.id, action: "vendor.bank_updated", entity: "vendor", entityId: vendorId, before: { last4: req.old_account_last4 }, after: { last4: req.new_account_last4 } });
    return { id: req.id, vendorId, status: "applied" as const };
  })();
}

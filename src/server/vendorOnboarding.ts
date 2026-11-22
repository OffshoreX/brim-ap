// Vendor onboarding: create as pending_review, then approve or hold. Roles are checked in the routes (requireRole);
// "the creator cannot approve" lives here because it needs the vendor row. Bank details are never accepted here:
// they only arrive through the verified bank-change flow in vendors.ts.
import { getDb } from "./db";
import { writeAudit } from "./audit";
import { idempotentSync } from "./idempotency";
import { exactKey, looseKey } from "./rules/vendorMatch";
import { cleanText, hasMixedScripts, lookalikes } from "./rules/unicode";
import { getVendor, VendorError } from "./vendors";
import type { User } from "@/contracts";

const FIELDS = ["name", "category", "province_or_state", "country", "gst_hst_number", "qst_number", "payment_terms_days", "preferred_payment_method", "ap_contact_email", "requires_po", "default_gl_account"] as const;
const text = (v: unknown, field: string, max: number) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.trim().length > max) throw new VendorError(400, `${field} must be text of at most ${max} characters`);
  return cleanText(v.trim()); // NFKC and no bidi controls, so what is stored is what the matcher compares
};
// Tax numbers are stored the way the dataset has them: upper case, letters and digits only.
const taxNumber = (v: unknown, field: string, shape: RegExp, example: string) => {
  const t = text(v, field, 40)?.toUpperCase().replace(/[\s-]/g, "") ?? null;
  if (t !== null && !shape.test(t)) throw new VendorError(400, `${field} must look like ${example}`);
  return t;
};

// Checks every field and returns the row to insert. Each failure is one plain message.
function validate(body: Record<string, unknown>) {
  const extra = Object.keys(body).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (extra.length) throw new VendorError(400, `Not accepted when creating a vendor: ${extra.join(", ")}${extra.some((k) => k.startsWith("bank")) ? " (bank details arrive through a verified bank change)" : ""}`);
  const name = text(body.name, "name", 200);
  if (!name || !exactKey(name)) throw new VendorError(400, "name is required and must contain letters or numbers");
  const terms = body.payment_terms_days ?? null;
  if (terms !== null && !(Number.isInteger(terms) && (terms as number) >= 0 && (terms as number) <= 365)) throw new VendorError(400, "payment_terms_days must be a whole number from 0 to 365");
  const method = body.preferred_payment_method ?? null;
  if (method !== null && !["EFT", "CHEQUE", "CARD"].includes(method as string)) throw new VendorError(400, "preferred_payment_method must be EFT, CHEQUE or CARD");
  const email = text(body.ap_contact_email, "ap_contact_email", 200);
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new VendorError(400, "ap_contact_email must be an email address");
  if (body.requires_po !== undefined && typeof body.requires_po !== "boolean") throw new VendorError(400, "requires_po must be true or false");
  const country = text(body.country, "country", 20)?.toUpperCase() ?? null;
  if (country !== null && !["CA", "US"].includes(country)) throw new VendorError(400, "country must be CA or US");
  const gl = text(body.default_gl_account, "default_gl_account", 20);
  if (gl !== null && !getDb().prepare("SELECT 1 FROM gl_accounts WHERE code = ?").get(gl)) throw new VendorError(400, `default_gl_account ${gl} is not a known GL account`);
  return {
    name, category: text(body.category, "category", 100), province_or_state: text(body.province_or_state, "province_or_state", 50), country,
    gst_hst_number: taxNumber(body.gst_hst_number, "gst_hst_number", /^\d{9}RT\d{4}$/, "123456789RT0001"),
    qst_number: taxNumber(body.qst_number, "qst_number", /^\d{10}TQ\d{4}$/, "1234567890TQ0001"),
    payment_terms_days: terms as number | null, preferred_payment_method: method as string | null, ap_contact_email: email,
    requires_po: body.requires_po === true ? 1 : 0, default_gl_account: gl,
  };
}

// Same two keys the invoice matcher uses, so a name the matcher could not tell apart from an existing vendor is refused here.
function assertNewName(name: string) {
  const [exact, loose] = [exactKey(name), looseKey(name)];
  const clash = (getDb().prepare("SELECT id, name FROM vendors").all() as { id: number; name: string }[]).find((v) => exactKey(v.name) === exact || looseKey(v.name) === loose);
  if (clash) throw new VendorError(409, `A vendor with this name already exists: "${clash.name}" (vendor ${clash.id})`);
  // Spelled differently but reads the same (a Cyrillic "а" in "Pacific Fuel"): refused, because it is how a fake vendor is created.
  const twin = lookalikes(name, getDb().prepare("SELECT id, name FROM vendors").all() as { id: number; name: string }[], exactKey)[0];
  if (twin) throw new VendorError(409, `This name looks like the existing vendor "${twin.name}" (vendor ${twin.id}) but is spelled with different letters`);
}

export function createVendor(user: User, body: Record<string, unknown>, key?: string | null) {
  return idempotentSync(user.id, "vendor.create", key, body, () => {
    const v = validate(body);
    assertNewName(v.name); // inside the write lock, so two creates of one name cannot both pass
    const db = getDb();
    const id = Number(
      db.prepare(
        `INSERT INTO vendors (name, category, province_or_state, country, gst_hst_number, qst_number, payment_terms_days, preferred_payment_method, ap_contact_email, requires_po, default_gl_account, status, onboarded_at, created_by_user_id)
         VALUES (@name, @category, @province_or_state, @country, @gst_hst_number, @qst_number, @payment_terms_days, @preferred_payment_method, @ap_contact_email, @requires_po, @default_gl_account, 'pending_review', strftime('%Y-%m-%dT%H:%M:%fZ','now'), @by)`
      ).run({ ...v, by: user.id }).lastInsertRowid
    );
    // A name that mixes alphabets is allowed but recorded as a warning for the approver (the audit row is what they read).
    writeAudit({ actorId: user.id, action: "vendor.create", entity: "vendor", entityId: id, after: { ...v, status: "pending_review", ...(hasMixedScripts(v.name) ? { warnings: ["name mixes alphabets"] } : {}) } });
    return getVendor(id);
  });
}

// One status move, audited. `from` is re-read inside the lock so a repeat click gets a 409 instead of a second audit row.
function moveStatus(user: User, id: number, scope: string, key: string | null | undefined, request: unknown, from: string, to: string, action: string, why: string, extra: Record<string, unknown> = {}) {
  return idempotentSync(user.id, scope, key, request, () => {
    const db = getDb();
    const v = db.prepare("SELECT status, created_by_user_id FROM vendors WHERE id = ?").get(id) as { status: string | null; created_by_user_id: number | null } | undefined;
    if (!v) throw new VendorError(404, "Vendor not found");
    if (v.status !== from) throw new VendorError(409, `${why} (this vendor is ${v.status ?? "without a status"})`);
    if (action === "vendor.approve" && v.created_by_user_id === user.id) throw new VendorError(403, "You created this vendor, so someone else must approve it");
    db.prepare("UPDATE vendors SET status = ? WHERE id = ?").run(to, id);
    writeAudit({ actorId: user.id, action, entity: "vendor", entityId: id, before: { status: from }, after: { status: to, ...extra } });
    return getVendor(id);
  });
}

export const approveVendor = (user: User, id: number, key?: string | null) =>
  moveStatus(user, id, "vendor.approve", key, { id }, "pending_review", "active", "vendor.approve", "Only a vendor pending review can be approved");

// Only an active vendor can be held: holding a pending one and releasing it would skip the approval.
export function holdVendor(user: User, id: number, reason: unknown, key?: string | null) {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (!r || r.length > 500) throw new VendorError(400, "reason is required (at most 500 characters)");
  return moveStatus(user, id, "vendor.hold", key, { id, reason: r }, "active", "on_hold", "vendor.hold", "Only an active vendor can be put on hold", { reason: r });
}

export const releaseHold = (user: User, id: number, key?: string | null) =>
  moveStatus(user, id, "vendor.release_hold", key, { id }, "on_hold", "active", "vendor.release_hold", "Only a vendor on hold can be released");

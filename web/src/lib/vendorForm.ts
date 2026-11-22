// The add-vendor form's fields, how its values become the request body, and how a server message finds its field.
import type { NewVendor } from "@/lib/types";

export const TEXT = ["name", "category", "province_or_state", "gst_hst_number", "qst_number", "ap_contact_email", "default_gl_account"] as const;
const FIELDS: string[] = [...TEXT, "country", "payment_terms_days", "preferred_payment_method", "requires_po"];
export type Form = Record<(typeof TEXT)[number] | "country" | "payment_terms_days" | "preferred_payment_method", string> & { requires_po: boolean };
export const EMPTY: Form = { name: "", category: "", province_or_state: "", gst_hst_number: "", qst_number: "", ap_contact_email: "", default_gl_account: "", country: "", payment_terms_days: "", preferred_payment_method: "", requires_po: false };

// The server words each refusal as one sentence that starts with the field name ("payment_terms_days must be ..."),
// so that is how a message finds its field. A duplicate name starts with "A vendor with this name". Anything else is general.
export function fieldOfError(message: string): string | null {
  const first = message.split(" ")[0] ?? "";
  if (FIELDS.includes(first)) return first;
  return message.startsWith("A vendor with this name") ? "name" : null;
}

// Empty boxes are left out, so the server sees "not given" and not an empty text.
export function vendorBody(f: Form): NewVendor {
  const body: NewVendor = { name: f.name.trim(), requires_po: f.requires_po };
  for (const k of TEXT) if (k !== "name" && f[k].trim()) body[k] = f[k].trim();
  if (f.country) body.country = f.country;
  if (f.preferred_payment_method) body.preferred_payment_method = f.preferred_payment_method;
  const t = f.payment_terms_days.trim();
  if (t) body.payment_terms_days = Number.isNaN(Number(t)) ? t : Number(t);
  return body;
}

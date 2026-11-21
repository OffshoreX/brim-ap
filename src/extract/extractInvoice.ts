// Reads an invoice PDF/image with the Anthropic Messages API (plain fetch, server-side only).
// Output is validated by hand; anything doubtful becomes needs_review, never a guess.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ExtractedInvoice = {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  dueDate: string | null;
  currency: "CAD" | "USD";
  lines: { description: string; quantity: string; unitPriceCents: number; amountCents: number }[];
  taxes: { label: string; code: string; amountCents: number }[];
  totalCents: number;
  poNumber: string | null;
  bankDetails: string | null;
  language: string;
};

export type ExtractResult =
  | { status: "ok"; invoice: ExtractedInvoice; cached: boolean }
  | { status: "needs_review"; reason: string };

const MIME_KIND: Record<string, "document" | "image"> = {
  "application/pdf": "document",
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
};

const PROMPT = `Extract this invoice. Reply with JSON only, no prose, no code fences, with exactly these keys:
vendorName, invoiceNumber, invoiceDate (YYYY-MM-DD), dueDate (YYYY-MM-DD or null), currency ("CAD" or "USD"),
lines [{description, quantity, unitPrice, amount}], taxes [{label, code, amount}], total,
poNumber (or null), bankDetails (or null), language (ISO code like "en" or "fr").
Every money value (unitPrice, amount, total) is a plain decimal string such as "1234.50": no currency symbol, no thousands separator.
If a field is not on the invoice use null. Never invent values.
For each line, quantity is a decimal string; use "1" when the invoice shows no quantity (flat services). If a line has no unit price use its amount.
For each tax, code is the tax code shown (for example GST, HST, QST, PST) or "" if none is shown. A credit note has negative amounts.`;

// Decimal string -> integer cents using string/integer math only (no floats).
export function toCents(v: unknown): number {
  if (typeof v !== "string" || !/^-?\d+(\.\d{1,2})?$/.test(v)) throw new Error(`bad amount ${JSON.stringify(v)}`);
  const neg = v.startsWith("-");
  const [whole, frac = ""] = v.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("amount too large");
  return neg ? -cents : cents;
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${name} missing`);
  return v.trim();
};
const optStr = (v: unknown, name: string): string | null => {
  if (v === null || v === undefined) return null;
  return str(v, name);
};
const date = (v: unknown, name: string): string => {
  const s = str(v, name);
  const d = new Date(`${s}T00:00:00Z`);
  // round-trip rejects 2026-02-31 style dates that Date would silently roll over
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s)
    throw new Error(`${name} is not a valid date`);
  return s;
};
const arr = (v: unknown, name: string): Record<string, unknown>[] => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "object" || x === null)) throw new Error(`${name} must be a list`);
  return v as Record<string, unknown>[];
};

export function validateInvoice(raw: unknown): ExtractedInvoice {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("not a JSON object");
  const r = raw as Record<string, unknown>;
  if (r.currency !== "CAD" && r.currency !== "USD") throw new Error("currency must be CAD or USD");
  const lines = arr(r.lines, "lines");
  if (lines.length === 0) throw new Error("no line items");
  return {
    vendorName: str(r.vendorName, "vendorName"),
    invoiceNumber: str(r.invoiceNumber, "invoiceNumber"),
    invoiceDate: date(r.invoiceDate, "invoiceDate"),
    dueDate: r.dueDate == null ? null : date(r.dueDate, "dueDate"),
    currency: r.currency,
    lines: lines.map((l) => {
      // Flat service lines often show no quantity: that means 1, not an error.
      const q = l.quantity == null || l.quantity === "" ? "1" : String(l.quantity).trim();
      if (!/^\d+(\.\d+)?$/.test(q)) throw new Error("bad quantity");
      // No unit price on the invoice: the line amount is the price of one unit.
      const unitPrice = l.unitPrice == null || l.unitPrice === "" ? l.amount : l.unitPrice;
      return { description: str(l.description, "description"), quantity: q, unitPriceCents: toCents(unitPrice), amountCents: toCents(l.amount) };
    }),
    taxes: arr(r.taxes ?? [], "taxes").map((t) => ({
      label: optStr(t.label, "tax label") ?? optStr(t.code, "tax code") ?? "Tax",
      code: optStr(t.code, "tax code") ?? "",
      amountCents: toCents(t.amount),
    })),
    totalCents: toCents(r.total),
    poNumber: optStr(r.poNumber, "poNumber"),
    bankDetails: optStr(r.bankDetails, "bankDetails"),
    language: str(r.language, "language"),
  };
}

export async function extractInvoice(
  fileBytes: Uint8Array,
  mimeType: string,
  opts: { cacheDir?: string } = {},
): Promise<ExtractResult> {
  const review = (reason: string): ExtractResult => ({ status: "needs_review", reason });
  try {
    const kind = MIME_KIND[mimeType];
    if (!kind) return review(`unsupported file type ${mimeType}`);

    // Cache first: the same bytes never reach the API twice, and need no key.
    const hash = createHash("sha256").update(fileBytes).digest("hex");
    const cacheFile = path.join(opts.cacheDir ?? path.join(process.cwd(), "data", "extract-cache"), `${hash}.json`);
    let cachedRaw: unknown;
    try {
      cachedRaw = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {
      // no cache entry (or unreadable): ask the model
    }
    if (cachedRaw !== undefined) {
      try {
        return { status: "ok", invoice: validateInvoice(cachedRaw), cached: true };
      } catch (e) {
        // The saved model answer fails today's checks. Do not pay for the same file again
        // unless asked (EXTRACT_RETRY=1); fixing the checks re-validates it for free.
        if (process.env.EXTRACT_RETRY !== "1") return review(`cached answer invalid: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return review("ANTHROPIC_API_KEY is not set");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.EXTRACT_MODEL || "claude-sonnet-5-5",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            { type: kind, source: { type: "base64", media_type: mimeType, data: Buffer.from(fileBytes).toString("base64") } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });
    if (!res.ok) return review(`model API returned HTTP ${res.status}`);

    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text")?.text;
    if (!text) return review("model returned no text");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      return review("model output was not valid JSON");
    }
    // Save the raw model JSON before checking it, so a stricter or fixed check never costs another API call.
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(parsed));
    const invoice = validateInvoice(parsed);
    return { status: "ok", invoice, cached: false };
  } catch (e) {
    // reason never includes the key: it only ever lives in the request header
    return review(e instanceof Error ? e.message : "extraction failed");
  }
}

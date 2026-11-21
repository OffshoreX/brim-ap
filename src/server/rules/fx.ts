import type { Finding } from "./types";

// rateBps: units of `to` per unit of `from`, times 10000 (1.3500 -> 13500).
export type FxRate = { from: string; to: string; rateBps: number };

// Rate is supplied by the caller; unknown pairs are refused, never guessed.
export function convertCents(amountCents: number, from: string, to: string, rate: FxRate | undefined): number {
  if (from === to) return amountCents;
  if (!rate || rate.from !== from || rate.to !== to) throw new Error(`Unknown currency pair ${from}->${to}`);
  // Round half up in integer math; credit notes are negative, so round the magnitude and keep the sign.
  const abs = Math.floor((Math.abs(amountCents) * rate.rateBps + 5_000) / 10_000);
  return amountCents < 0 ? -abs : abs;
}

// A stored invoice should carry the day's rate from the rate table and a CAD total that follows from it (history check).
// tableRateBps is the table's USD->CAD rate for the invoice date (undefined: no row). Only USD and CAD exist in the data.
export type StoredFx = { currency: string; totalCents: number; totalCadCents: number | null; rateBps: number | null };
export function checkStoredFx(inv: StoredFx, tableRateBps: number | undefined): Finding[] {
  const err = (code: string, message: string): Finding => ({ code, severity: "error", message });
  const rate = inv.currency === "CAD" ? 10_000 : tableRateBps;
  if (rate === undefined) return [err("fx_rate_missing", `No ${inv.currency}->CAD rate for the invoice date`)];
  const out: Finding[] = [];
  if (inv.rateBps !== rate) out.push(err("fx_rate_mismatch", `Invoice rate ${inv.rateBps} differs from the table rate ${rate}`));
  // One cent of slack: the dataset rounds the converted total, and a rounding difference is not mess.
  const want = convertCents(inv.totalCents, inv.currency, "CAD", { from: inv.currency, to: "CAD", rateBps: rate });
  if (inv.totalCadCents === null || Math.abs(inv.totalCadCents - want) > 1) out.push(err("fx_total_cad_mismatch", `CAD total ${inv.totalCadCents} but ${want} follows from the rate`));
  return out;
}

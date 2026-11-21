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

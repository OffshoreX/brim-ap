// Bank and card reconciliation: pure functions, no database, no model. Each released payment is matched one to one
// against a bank debit (EFT, cheque) or a card transaction (CARD) by amount in cents, a date window, and the payee text.
// An EFT or card charge posts within a few days either side of the paid date.
export const DATE_WINDOW_DAYS = 5;
// A cheque is cashed later, so its bank line may only come after the paid date, up to this many days.
export const CHEQUE_CLEAR_DAYS = 30;
// A different amount still counts as "the same payment, wrong amount" only when it is this close (percent of the payment).
export const AMOUNT_DIFF_MAX_PCT = 10;
// Vendor names are compared on this many leading characters because bank and card descriptors truncate the tail.
const NAME_KEY_CHARS = 16;

export type PayInput = { id: number; method: "EFT" | "CHEQUE" | "CARD"; amountCents: number; paidDate: string; vendorName: string | null; reference: string | null };
// text = bank description or card merchant descriptor; cents = bank debit or card amount in CAD.
export type LineInput = { id: string; date: string; text: string; cents: number };
export type PayStatus = "matched" | "unmatched" | "ambiguous" | "amount_diff";
export type PayResult = { paymentId: number; status: PayStatus; lineId: string | null; diffCents: number | null; reason: string | null };
export type Duplicate = { paymentId: number; lineId: string };
export type Reconciled = { payments: PayResult[]; duplicates: Duplicate[]; orphanLineIds: string[] };

const day = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
export const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
export const nameKey = (name: string) => norm(name).slice(0, NAME_KEY_CHARS).trim();

// The payee shows up as the tail digits of our payment reference (decisive) or as the vendor's name (possibly truncated).
export function refMatches(text: string, reference: string | null): boolean {
  const digits = (reference ?? "").replace(/\D/g, "");
  return (norm(text).match(/\d{5,}/g) ?? []).some((run) => digits.endsWith(run));
}
export function nameMatches(text: string, vendorName: string | null): boolean {
  const key = vendorName ? nameKey(vendorName) : "";
  return key.length >= 4 && norm(text).includes(key);
}

// Cheque lines carry only a cheque number, so they cannot name the payee; every other line must.
const needsPayee = (p: PayInput) => p.method !== "CHEQUE";

function inWindow(p: PayInput, l: LineInput): boolean {
  const gap = day(l.date) - day(p.paidDate);
  return p.method === "CHEQUE" ? gap >= 0 && gap <= CHEQUE_CLEAR_DAYS : Math.abs(gap) <= DATE_WINDOW_DAYS;
}

type Edges = Map<number, LineInput[]>;

// Take every payment whose only candidate line is claimed by nobody else, repeat until nothing more settles.
function settleUnique(pays: PayInput[], edges: Edges, taken: Map<number, LineInput>) {
  for (let again = true; again; ) {
    again = false;
    for (const p of pays) {
      if (taken.has(p.id)) continue;
      const free = (edges.get(p.id) ?? []).filter((l) => ![...taken.values()].includes(l));
      if (free.length !== 1) continue;
      const rivals = pays.filter((o) => o.id !== p.id && !taken.has(o.id) && (edges.get(o.id) ?? []).includes(free[0]));
      if (rivals.length) continue;
      taken.set(p.id, free[0]);
      again = true;
    }
  }
}

function matchSide(pays: PayInput[], lines: LineInput[]): Reconciled {
  // A line whose digits belong to some payment's reference is that payment's line, whatever vendor name it also carries.
  // This is what tells two same-amount payments to one vendor apart.
  const owners = new Map(lines.map((l) => [l, pays.filter((p) => refMatches(l.text, p.reference)).map((p) => p.id)]));
  const fits = (p: PayInput, l: LineInput) => {
    if (!needsPayee(p)) return true;
    const owned = owners.get(l) as number[];
    return owned.length ? owned.includes(p.id) : nameMatches(l.text, p.vendorName);
  };
  const taken = new Map<number, LineInput>(); // payment id -> its line
  const results = new Map<number, PayResult>();
  const duplicates: Duplicate[] = [];
  const dupLines = new Set<LineInput>();
  const isTaken = (l: LineInput) => dupLines.has(l) || [...taken.values()].includes(l);

  // Pass 1: exact amount, in the window, naming the payee.
  const exact: Edges = new Map(pays.map((p) => [p.id, lines.filter((l) => l.cents === p.amountCents && inWindow(p, l) && fits(p, l))]));
  settleUnique(pays, exact, taken);
  for (const p of pays) {
    if (taken.has(p.id)) continue;
    const cands = (exact.get(p.id) ?? []).filter((l) => !isTaken(l));
    if (!cands.length) continue;
    const contested = cands.some((l) => pays.some((o) => o.id !== p.id && !taken.has(o.id) && (exact.get(o.id) ?? []).includes(l)));
    if (contested) {
      results.set(p.id, { paymentId: p.id, status: "ambiguous", lineId: null, diffCents: null, reason: `${cands.length} line(s) fit this amount and date and other payments compete for them (${cands.map((l) => l.id).join(", ")})` });
      continue;
    }
    // Only this payment fits, yet several lines do: the first is the payment, the rest are the bank taking the money again.
    const [first, ...rest] = [...cands].sort((a, b) => day(a.date) - day(b.date) || a.id.localeCompare(b.id));
    taken.set(p.id, first);
    for (const l of rest) {
      duplicates.push({ paymentId: p.id, lineId: l.id });
      dupLines.add(l);
    }
  }

  // Pass 2: payments still without a line, same payee and window but a different amount close to ours.
  const open = pays.filter((p) => !taken.has(p.id) && !results.has(p.id) && needsPayee(p));
  const near: Edges = new Map(open.map((p) => [p.id, lines.filter((l) => !isTaken(l) && l.cents !== p.amountCents && inWindow(p, l) && fits(p, l) && Math.abs(l.cents - p.amountCents) * 100 <= p.amountCents * AMOUNT_DIFF_MAX_PCT)]));
  const diffTaken = new Map<number, LineInput>();
  settleUnique(open, near, diffTaken);
  for (const [id, l] of diffTaken) {
    const p = pays.find((x) => x.id === id) as PayInput;
    results.set(id, { paymentId: id, status: "amount_diff", lineId: l.id, diffCents: l.cents - p.amountCents, reason: `line ${l.id} for the same payee differs by ${l.cents - p.amountCents} cents` });
    taken.set(id, l);
  }
  for (const p of open) {
    if (diffTaken.has(p.id)) continue;
    const c = (near.get(p.id) ?? []).filter((l) => !isTaken(l));
    if (c.length) results.set(p.id, { paymentId: p.id, status: "ambiguous", lineId: null, diffCents: null, reason: `${c.length} line(s) for this payee are close in amount but none settles (${c.map((l) => l.id).join(", ")})` });
  }

  const payments = pays.map(
    (p): PayResult =>
      results.get(p.id) ??
      (taken.has(p.id)
        ? { paymentId: p.id, status: "matched", lineId: (taken.get(p.id) as LineInput).id, diffCents: 0, reason: null }
        : { paymentId: p.id, status: "unmatched", lineId: null, diffCents: null, reason: p.method === "CHEQUE" ? `no cheque line for this amount within ${CHEQUE_CLEAR_DAYS} days (may still be outstanding)` : "no line with this amount and payee in the date window" })
  );
  return { payments, duplicates, orphanLineIds: lines.filter((l) => !isTaken(l)).map((l) => l.id) };
}

// Bank-paid methods (EFT, cheque) face the bank lines, card payments face the card lines. Both are independent runs.
export function reconcile(pays: PayInput[], bank: LineInput[], card: LineInput[]): { bank: Reconciled; card: Reconciled } {
  return {
    bank: matchSide(pays.filter((p) => p.method !== "CARD"), bank),
    card: matchSide(pays.filter((p) => p.method === "CARD"), card),
  };
}

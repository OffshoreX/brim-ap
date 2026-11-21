import { expect, test } from "vitest";
import { AMOUNT_DIFF_MAX_PCT, CHEQUE_CLEAR_DAYS, DATE_WINDOW_DAYS, reconcile, type LineInput, type PayInput } from "./reconcile";

const pay = (id: number, over: Partial<PayInput> = {}): PayInput => ({ id, method: "EFT", amountCents: 100_000, paidDate: "2026-03-10", vendorName: "Acme Freight Ltd.", reference: `BRIM-EFT-1000${id}`, ...over });
const line = (id: string, over: Partial<LineInput> = {}): LineInput => ({ id, date: "2026-03-11", text: "EFT PMT ACME FREIGHT LTD  000000", cents: 100_000, ...over });
const bank = (pays: PayInput[], lines: LineInput[]) => reconcile(pays, lines, []).bank;
const status = (r: ReturnType<typeof bank>, id: number) => r.payments.find((p) => p.paymentId === id)!;

test("one payment and one line with the same amount, payee and a close date match", () => {
  const r = bank([pay(1)], [line("B1")]);
  expect(status(r, 1)).toMatchObject({ status: "matched", lineId: "B1", diffCents: 0 });
  expect(r.orphanLineIds).toEqual([]);
});

test("the date window is a few days either side, no more", () => {
  expect(status(bank([pay(1)], [line("B1", { date: "2026-03-15" })]), 1).status).toBe("matched"); // +5
  expect(DATE_WINDOW_DAYS).toBe(5);
  const late = bank([pay(1)], [line("B1", { date: "2026-03-16" })]);
  expect(status(late, 1).status).toBe("unmatched");
  expect(late.orphanLineIds).toEqual(["B1"]);
});

test("a line for another vendor never matches, even with the same amount and date", () => {
  expect(status(bank([pay(1)], [line("B1", { text: "EFT PMT OTHER SUPPLIES CO 123456" })]), 1).status).toBe("unmatched");
});

test("a truncated vendor name still matches", () => {
  const p = pay(1, { vendorName: "Stampede Trail Industrial Parks" });
  expect(status(bank([p], [line("B1", { text: "EFT PMT STAMPEDE TRAIL INDUSTRIA 717867" })]), 1).status).toBe("matched");
});

test("two same-amount payments to one vendor are told apart by the reference digits on each line", () => {
  const pays = [pay(1, { reference: "BRIM-EFT-67571868" }), pay(2, { reference: "BRIM-EFT-47280136" })];
  const lines = [line("B1", { text: "EFT PMT ACME FREIGHT LTD 280136" }), line("B2", { text: "EFT PMT ACME FREIGHT LTD 571868" })];
  const r = bank(pays, lines);
  expect([status(r, 1).lineId, status(r, 2).lineId]).toEqual(["B2", "B1"]);
});

test("two same-amount payments and two lines with no reference to tell them apart stay ambiguous, unmatched, with the reason", () => {
  const r = bank([pay(1), pay(2)], [line("B1"), line("B2")]);
  for (const id of [1, 2]) expect(status(r, id)).toMatchObject({ status: "ambiguous", lineId: null, reason: expect.stringContaining("B1") });
});

test("one payment with two fitting lines: the first is the payment, the second is reported as a duplicate", () => {
  const r = bank([pay(1)], [line("B2", { date: "2026-03-12" }), line("B1", { date: "2026-03-11" })]);
  expect(status(r, 1)).toMatchObject({ status: "matched", lineId: "B1" });
  expect(r.duplicates).toEqual([{ paymentId: 1, lineId: "B2" }]);
  expect(r.orphanLineIds).toEqual([]);
});

test("a line is never used twice: with one line for two payments, neither is matched", () => {
  const r = bank([pay(1), pay(2)], [line("B1")]);
  expect(r.payments.map((p) => p.status)).toEqual(["ambiguous", "ambiguous"]);
});

test("a close amount for the same payee is an amount_diff with the signed difference", () => {
  const r = bank([pay(1)], [line("B1", { cents: 99_999 })]);
  expect(status(r, 1)).toMatchObject({ status: "amount_diff", lineId: "B1", diffCents: -1 });
  expect(r.orphanLineIds).toEqual([]);
});

test("an amount far off is not the same payment", () => {
  const far = 100_000 + Math.ceil((100_000 * (AMOUNT_DIFF_MAX_PCT + 1)) / 100);
  const r = bank([pay(1)], [line("B1", { cents: far })]);
  expect(status(r, 1).status).toBe("unmatched");
  expect(r.orphanLineIds).toEqual(["B1"]);
});

test("an exact match is preferred over a near amount, and the near line stays an orphan", () => {
  const r = bank([pay(1)], [line("B1", { cents: 100_001 }), line("B2")]);
  expect(status(r, 1)).toMatchObject({ status: "matched", lineId: "B2" });
  expect(r.orphanLineIds).toEqual(["B1"]);
});

test("a cheque matches a later line by amount alone, and not an earlier one or one past the clearing limit", () => {
  const c = pay(1, { method: "CHEQUE", reference: "BRIM-CHQ-76443025" });
  const text = "CHEQUE 5001 CLEARED";
  expect(status(bank([c], [line("B1", { text, date: "2026-03-20" })]), 1).status).toBe("matched");
  expect(status(bank([c], [line("B1", { text, date: "2026-03-09" })]), 1).status).toBe("unmatched");
  const r = bank([c], [line("B1", { text, date: "2026-04-20" })]);
  expect(CHEQUE_CLEAR_DAYS).toBe(30);
  expect(status(r, 1)).toMatchObject({ status: "unmatched", reason: expect.stringContaining("outstanding") });
});

test("card payments match the card file by CAD amount and merchant, and never touch the bank side", () => {
  const p = pay(1, { method: "CARD", vendorName: "Cloudbarn Software Inc.", reference: "BRIM-VC-17166635" });
  const card: LineInput[] = [{ id: "C1", date: "2026-03-10", text: "CLOUDBARN SOFTWARE INC", cents: 100_000 }, { id: "C2", date: "2026-03-10", text: "ROADHOUSE GRILL", cents: 100_000 }];
  const r = reconcile([p], [line("B1")], card);
  expect(r.card.payments[0]).toMatchObject({ status: "matched", lineId: "C1" });
  expect(r.card.orphanLineIds).toEqual(["C2"]);
  expect(r.bank.payments).toEqual([]);
  expect(r.bank.orphanLineIds).toEqual(["B1"]);
});

test("no payments at all leaves every line an orphan and nothing throws", () => {
  expect(bank([], [line("B1")])).toEqual({ payments: [], duplicates: [], orphanLineIds: ["B1"] });
});

import { describe, expect, it } from "vitest";
import { chooseMethod, discountCentsFor, discountDeadline, dueDateFor, parseEarlyPayTerms, proposedPayDate } from "./paymentTerms";

// The two values that really appear in brim_ap_dataset/data/vendors.csv (early_pay_discount): blank and "2/10 net 30".
describe("parseEarlyPayTerms", () => {
  it("reads the real dataset format", () => expect(parseEarlyPayTerms("2/10 net 30")).toEqual({ kind: "discount", percentBps: 200, discountDays: 10, netDays: 30 }));
  it("treats the real blank value as no terms, without a note", () => {
    expect(parseEarlyPayTerms("")).toEqual({ kind: "none" });
    expect(parseEarlyPayTerms(null)).toEqual({ kind: "none" });
    expect(parseEarlyPayTerms("  ")).toEqual({ kind: "none" });
  });
  it("tolerates case and spacing of the same format", () => {
    expect(parseEarlyPayTerms(" 2 / 10  NET 30 ")).toMatchObject({ kind: "discount", percentBps: 200 });
    expect(parseEarlyPayTerms("1.5/15 net30")).toMatchObject({ kind: "discount", percentBps: 150, discountDays: 15 });
  });
  it.each(["net 30", "2% 10 days", "2/10", "two/ten net thirty", "0/10 net 30", "101/10 net 30", "2/40 net 30"])("never guesses: %j gives a note", (t) => {
    const r = parseEarlyPayTerms(t);
    expect(r.kind).toBe("unparsed");
    expect(r.kind === "unparsed" && r.note).toContain(t);
  });
});

describe("dates", () => {
  it("due date is invoice date plus terms, and 0 means due on receipt", () => {
    expect(dueDateFor("2026-01-01", 30)).toBe("2026-01-31");
    expect(dueDateFor("2026-01-01", 0)).toBe("2026-01-01");
    expect(dueDateFor("2026-01-01", 15)).toBe("2026-01-16");
    expect(dueDateFor("2026-01-01", 21)).toBe("2026-01-22");
    expect(dueDateFor("2026-02-20", 30)).toBe("2026-03-22");
  });
  it("unknown terms give no due date", () => {
    expect(dueDateFor("2026-01-01", null)).toBeNull();
    expect(dueDateFor("2026-01-01", -5)).toBeNull();
  });
  it("discount deadline is invoice date plus the discount days", () => {
    expect(discountDeadline(parseEarlyPayTerms("2/10 net 30"), "2026-01-05")).toBe("2026-01-15");
    expect(discountDeadline(parseEarlyPayTerms(""), "2026-01-05")).toBeNull();
    expect(discountDeadline(parseEarlyPayTerms("net 30"), "2026-01-05")).toBeNull();
  });
});

describe("discountCentsFor", () => {
  const t = parseEarlyPayTerms("2/10 net 30");
  it("is 2% of the subtotal inside the window, both ends included (dataset PAY-00015: 37.13)", () => {
    expect(discountCentsFor(t, "2026-01-05", "2026-01-05", 185_665)).toBe(3713);
    expect(discountCentsFor(t, "2026-01-05", "2026-01-15", 185_665)).toBe(3713);
  });
  it("is zero before the invoice, after the window, and for unparsed terms", () => {
    expect(discountCentsFor(t, "2026-01-05", "2026-01-04", 185_665)).toBe(0);
    expect(discountCentsFor(t, "2026-01-05", "2026-01-16", 185_665)).toBe(0);
    expect(discountCentsFor(parseEarlyPayTerms("net 30"), "2026-01-05", "2026-01-06", 185_665)).toBe(0);
  });
});

describe("proposedPayDate", () => {
  const t = parseEarlyPayTerms("2/10 net 30");
  it("proposes the deadline while the discount can still be taken", () => expect(proposedPayDate(t, "2026-01-05", "2026-02-04", "2026-01-08")).toEqual({ date: "2026-01-15", early: true }));
  it("proposes the due date once the window has closed", () => expect(proposedPayDate(t, "2026-01-05", "2026-02-04", "2026-01-16")).toEqual({ date: "2026-02-04", early: false }));
  it("proposes the due date when the vendor has no discount", () => expect(proposedPayDate(parseEarlyPayTerms(""), "2026-01-05", "2026-02-04", "2026-01-08")).toEqual({ date: "2026-02-04", early: false }));
  it("falls back to today when nothing else is known", () => expect(proposedPayDate({ kind: "none" }, "2026-01-05", null, "2026-01-08")).toEqual({ date: "2026-01-08", early: false }));
});

describe("chooseMethod", () => {
  it("follows the preferred method", () => {
    expect(chooseMethod("CHEQUE", false)).toEqual({ ok: true, method: "CHEQUE" });
    expect(chooseMethod("CARD", true)).toEqual({ ok: true, method: "CARD" });
    expect(chooseMethod(null, false)).toEqual({ ok: true, method: "EFT" });
  });
  it("uses CARD only when accepted: a vendor that prefers EFT but accepts card stays EFT", () => expect(chooseMethod("EFT", true)).toEqual({ ok: true, method: "EFT" }));
  it("refuses a requested CARD the vendor does not accept, and falls back to EFT with a note for a bad preference", () => {
    expect(chooseMethod("EFT", false, "CARD")).toEqual({ ok: false, reason: "This vendor does not accept card payments" });
    expect(chooseMethod("CARD", false)).toMatchObject({ ok: true, method: "EFT", note: expect.any(String) });
  });
  it("lets a clerk request another method", () => expect(chooseMethod("EFT", false, "CHEQUE")).toEqual({ ok: true, method: "CHEQUE" }));
});

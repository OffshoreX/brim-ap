import { describe, expect, it } from "vitest";
import { describeFilters, dollarsToCents, parseFilters, toApi } from "@/lib/invoiceFilters";

describe("invoice filters", () => {
  it("turns dollars into whole cents without floats", () => {
    expect(dollarsToCents("1,234.5")).toBe(123450);
    expect(dollarsToCents("$0.07")).toBe(7);
    expect(dollarsToCents("19.99")).toBe(1999);
    expect(dollarsToCents("1.005")).toBeUndefined();
    expect(dollarsToCents("-5")).toBeUndefined();
    expect(dollarsToCents("abc")).toBeUndefined();
  });

  it("maps URL filters to the server's parameter names and drops bad input", () => {
    const f = parseFilters({ q: " acme ", vendor: "7", min: "10", max: "x", from: "2026-01-02", to: "nope", sort: "bogus" });
    expect(f).toMatchObject({ q: "acme", vendor: 7, min: "10", from: "2026-01-02", sort: undefined, to: undefined });
    expect(toApi(f)).toEqual({ q: "acme", vendorId: 7, minCents: 1000, from: "2026-01-02" });
  });

  it("accepts numbers the router already parsed from the URL", () => {
    expect(parseFilters({ min: 1000, q: 123 })).toMatchObject({ min: "1000", q: "123" });
  });

  it("names the active filters", () => {
    expect(describeFilters({ q: "x", min: "5", dueTo: "2026-02-01" })).toEqual(['search "x"', "amount from $5", "due to 2026-02-01"]);
  });
});

import { describe, expect, test } from "vitest";
import { exactKey, looseKey, matchVendor, type VendorRef } from "./vendorMatch";

// Names as they appear in vendors.csv (legal_name), including the lookalike records V051-V053.
const master: VendorRef[] = [
  [1, "Polar Freight Lines Ltd.", "995133220RT0001"], [2, "Great Lakes Carriers Inc.", "367912731RT0001"], [4, "Cascadia Cartage Ltd."],
  [15, "Cloudbarn Software Inc."], [26, "Harlow & Stern LLP", "111111111RT0001"], [27, "Beaumont Riviere S.E.N.C.R.L."],
  [28, "Ledgerline Chartered Professional Accountants"], [31, "Signal & Sparrow Creative"], [33, "Lumen Print & Signage"],
  [39, "Place Mont-Royal Immobilier"], [47, "Alpenglow Events & Catering"], [51, "Polar Freight Lines Limited", "995133220RT0001"],
  [52, "Harlow and Stern LLP", "111111111RT0001"], [53, "Great Lakes Carriers Incorporated"], [54, "Riverbend Catering Co."],
].map(([id, name, taxNumber]) => ({ id: id as number, name: name as string, taxNumber: (taxNumber as string | undefined) ?? null }));

const idOf = (name: string, tax?: string) => {
  const m = matchVendor(name, master, tax);
  return m.status === "matched" ? m.id : m;
};

describe("keys", () => {
  test("exactKey ignores case, accents, spaces and punctuation but keeps 'and'", () => {
    expect(exactKey("Beaumont Rivière S.E.N.C.R.L.")).toBe(exactKey("BEAUMONT RIVIERE SENCRL"));
    expect(exactKey("Harlow & Stern LLP")).not.toBe(exactKey("Harlow and Stern LLP"));
  });
  test("looseKey treats & and 'and' alike and drops legal forms", () => {
    expect(looseKey("Harlow & Stern LLP")).toBe(looseKey("Harlow and Stern LLP"));
    expect(looseKey("Polar Freight Lines Ltd.")).toBe(looseKey("polar freight lines LIMITED"));
    expect(looseKey("Beaumont Rivière S.E.N.C.R.L.")).toBe("beaumontriviere");
    expect(looseKey("Cloudbarn Software Inc")).toBe(looseKey("Cloudbarn Software Incorporated"));
    expect(looseKey("Compagnie Laurentienne Ltée")).toBe(looseKey("Compagnie Laurentienne Limitée"));
  });
  test("a name that is only a legal form is kept, not emptied", () => {
    expect(looseKey("Co.")).toBe("co");
    expect(looseKey("&")).toBe("");
  });
});

describe("matchVendor by name", () => {
  test("the name as written wins over a lookalike record", () => {
    expect(idOf("Polar Freight Lines Ltd.")).toBe(1);
    expect(idOf("Great Lakes Carriers Inc.")).toBe(2);
    expect(idOf("Harlow & Stern LLP")).toBe(26);
    expect(idOf("Harlow and Stern LLP")).toBe(52);
  });
  test("formatting differences still match", () => {
    expect(idOf("CASCADIA CARTAGE LTD")).toBe(4);
    expect(idOf("Beaumont Rivière S.E.N.C.R.L.")).toBe(27);
    expect(idOf("Place Mont Royal Immobilier")).toBe(39);
    expect(idOf("Signal and Sparrow Creative")).toBe(31);
    expect(idOf("Alpenglow Events and Catering Inc.")).toBe(47);
    expect(idOf("Riverbend Catering Company")).toBe(54);
  });
  test("a name that fits two records is ambiguous, never picked", () => {
    expect(idOf("Polar Freight Lines")).toEqual({ status: "ambiguous", ids: [1, 51] });
    expect(idOf("Great Lakes Carriers")).toEqual({ status: "ambiguous", ids: [2, 53] });
    expect(idOf("Harlow Stern")).toEqual({ status: "ambiguous", ids: [26, 52] });
  });
  test("an unknown vendor is no match", () => {
    expect(idOf("Blue Heron Couriers")).toEqual({ status: "none" });
    expect(idOf("Zephyr Data Services Inc.")).toEqual({ status: "none" });
  });
  test("different companies that share only a legal form do not match", () => {
    expect(idOf("Cloudbarn Hosting Inc.")).toEqual({ status: "none" });
    expect(idOf("Inc.")).toEqual({ status: "none" });
  });
});

describe("matchVendor by tax number", () => {
  test("a unique tax number decides, whatever the name says", () => {
    expect(matchVendor("Some Other Name", master, "367912731 rt0001")).toEqual({ status: "matched", id: 2, by: "tax_number" });
  });
  test("a tax number shared by duplicate records is narrowed by the name, else ambiguous", () => {
    expect(idOf("Polar Freight Lines Limited", "995133220RT0001")).toBe(51);
    expect(idOf("Polar Freight Lines Ltd.", "995133220RT0001")).toBe(1);
    expect(idOf("Harlow Stern", "111111111RT0001")).toEqual({ status: "ambiguous", ids: [26, 52] });
    expect(idOf("Unrelated Name", "995133220RT0001")).toEqual({ status: "ambiguous", ids: [1, 51] });
  });
  test("an unknown tax number falls back to the name", () => {
    expect(idOf("Cascadia Cartage Ltd.", "000000000RT0001")).toBe(4);
  });
});

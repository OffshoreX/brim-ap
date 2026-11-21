import { beforeEach, describe, expect, test } from "vitest";
import { GET as aging } from "@/app/api/reports/aging/route";
import { GET as discounts } from "@/app/api/reports/discounts/route";
import { GET as spend } from "@/app/api/reports/spend/route";
import { getDb, resetDbForTests } from "./db";
import { toCsv } from "./reports";
import { signSession } from "./session";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const cookie = (id: number) => ({ cookie: `session=${signSession(id)}` });
const get = (route: (r: Request) => Promise<Response>, query = "", user = 1) => route(new Request(`http://x/api/r${query}`, { headers: cookie(user) }));

beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.exec(`
    INSERT INTO users (id,name,role) VALUES (1,'Fin','finance_manager'),(2,'Emp','employee');
    INSERT INTO departments (id,name) VALUES (1,'Ops'),(2,'Sales');
    INSERT INTO vendors (id,name,early_pay_discount) VALUES (1,'Acme','2/10 net 30'),(2,'=Evil, Co',''),(3,'Odd','weird terms');
    -- as-of 2026-11-02: due 10-20 = 13 days past due, 09-01 = 62, 07-01 = 124, 11-30 not yet due
    INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,due_date,subtotal_cents,total_cents,currency,total_cad_cents,department_id) VALUES
      (1,'approved',1,'A1','2026-10-01','2026-10-20',10000,11300,'CAD',11300,1),
      (2,'pending_approval',2,'B1','2026-08-02','2026-09-01',20000,22600,'CAD',22600,2),
      (3,'scheduled',2,'B2','2026-06-01','2026-07-01',5000,5650,'CAD',5650,2),
      (4,'approved',1,'A2','2026-11-01','2026-11-30',1000,1130,'CAD',1130,1),
      (5,'paid',1,'A3','2026-10-05','2026-11-04',10000,11300,'CAD',11300,1),
      (6,'paid',1,'A4','2026-10-06','2026-11-05',10000,11300,'CAD',11300,1),
      (7,'rejected',2,'B3','2026-10-06','2026-10-10',1000,1130,'CAD',1130,2);
    INSERT INTO payments (invoice_id,vendor_id,amount_cents,currency,amount_cad_cents,discount_taken_cents,status) VALUES
      (5,1,11100,'CAD',11100,200,'settled'),
      (6,1,11300,'CAD',11300,0,'settled');
  `);
});

describe("aging report", () => {
  test("open past-due invoices fall in the right buckets; paid, rejected and not-yet-due are left out", async () => {
    const rows = await (await get(aging)).json();
    expect(rows).toEqual([
      { bucket: "0-30", invoices: 1, totalCadCents: 11300 },
      { bucket: "31-60", invoices: 0, totalCadCents: 0 },
      { bucket: "61-90", invoices: 1, totalCadCents: 22600 },
      { bucket: "90+", invoices: 1, totalCadCents: 5650 },
    ]);
  });
  test("asOf moves the buckets; junk is a 400", async () => {
    expect((await (await get(aging, "?asOf=2026-10-21")).json())[0]).toEqual({ bucket: "0-30", invoices: 1, totalCadCents: 11300 });
    expect((await get(aging, "?asOf=soon")).status).toBe(400);
  });
});

describe("spend report", () => {
  test("by department, biggest first, rejected excluded", async () => {
    const rows = await (await get(spend, "?by=department")).json();
    expect(rows).toEqual([
      { key: "Ops", invoices: 4, totalCadCents: 11300 + 1130 + 11300 + 11300 },
      { key: "Sales", invoices: 1, totalCadCents: 5650 },
    ]);
  });
  test("by vendor and by month; paging sets the total header", async () => {
    const byVendor = await get(spend, "?by=vendor&limit=1");
    expect(await byVendor.json()).toEqual([{ key: "Acme", invoices: 4, totalCadCents: 35030 }]);
    expect(byVendor.headers.get("X-Total-Count")).toBe("2");
    const byMonth = await (await get(spend, "?by=month")).json();
    expect(byMonth.map((r: { key: string }) => r.key).sort()).toEqual(["2026-06", "2026-10", "2026-11"]);
  });
  test("bad by is a 400; CSV ignores paging and neutralises formulas", async () => {
    expect((await get(spend, "?by=colour")).status).toBe(400);
    const res = await get(spend, "?by=vendor&format=csv&limit=1");
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines).toEqual(["key,invoices,totalCadCents", "Acme,4,35030", `"'=Evil, Co",1,5650`]);
  });
});

describe("discounts report", () => {
  test("taken versus missed for vendors with readable early-pay terms only", async () => {
    // Acme 2/10: invoice 5 took 200; invoice 6 (subtotal 10000) paid with none, so 2% = 200 was missed
    expect(await (await get(discounts)).json()).toEqual([{ vendor: "Acme", terms: "2/10 net 30", takenPayments: 1, takenCadCents: 200, missedPayments: 1, missedCadCents: 200 }]);
  });
  test("CSV export has a header and one row", async () => {
    const text = await (await get(discounts, "?format=csv")).text();
    expect(text.trim().split("\r\n")).toEqual(["vendor,terms,takenPayments,takenCadCents,missedPayments,missedCadCents", "Acme,2/10 net 30,1,200,1,200"]);
  });
});

test("an employee is refused every report", async () => {
  for (const r of [aging, spend, discounts]) expect((await get(r, "", 2)).status).toBe(403);
});

test("toCsv quotes commas, quotes and newlines", () => {
  expect(toCsv([{ a: 'x,"y"\nz', b: 1 }], ["a", "b"])).toBe('a,b\r\n"x,""y""\nz",1\r\n');
});

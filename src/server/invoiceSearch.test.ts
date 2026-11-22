import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { GET as list } from "@/app/api/invoices/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// Invoice ids 1..5, inserted in order. Employee 1 owns 1, 2, 5; employee 2 owns 3, 4.
const rows: [number, number, string, string, number, string | null][] = [
  // requester, vendor, number, invoice_date, cents, due
  [1, 1, "INV-100", "2026-01-10", 10000, "2026-02-10"],
  [1, 1, "inv-200", "2026-02-15", 50000, null],
  [2, 2, "100%_OFF", "2026-03-20", 25000, "2026-01-05"],
  [2, 2, "ZZ-9", "2026-04-01", 99900, "2026-05-01"],
  [1, 2, "A-300", "2026-02-01", 5000, "2026-04-01"],
];

beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  db.prepare("INSERT INTO users (id,name,role) VALUES (1,'E1','employee'),(2,'E2','employee'),(3,'Clerk','ap_clerk')").run();
  db.prepare("INSERT INTO vendors (id,name) VALUES (1,'Acme Freight'),(2,'Blue_Harbor Co')").run();
  for (const [req, ven, num, date, cents, due] of rows)
    db.prepare("INSERT INTO invoices (status,vendor_id,invoice_number,invoice_date,total_cents,currency,requester_id,due_date) VALUES ('received',?,?,?,?,'CAD',?,?)").run(ven, num, date, cents, req, due);
});

const get = async (qs: string, u = 3) => {
  const res = await list(new Request(`http://x/api/invoices?${qs}`, { headers: { cookie: `session=${signSession(u)}` } }));
  return { res, ids: res.status === 200 ? (await res.clone().json()).map((i: { id: number }) => i.id) : [], total: res.headers.get("X-Total-Count") };
};

test("q matches invoice number or vendor name, case-insensitive and trimmed", async () => {
  expect((await get("q=%20INV-%20")).ids).toEqual([2, 1]);
  expect((await get("q=acme")).ids).toEqual([2, 1]);
  expect((await get("q=HARBOR")).ids).toEqual([5, 4, 3]);
});

test("each filter narrows the list and the total follows", async () => {
  expect((await get("vendorId=1")).ids).toEqual([2, 1]);
  expect((await get("minCents=25000")).ids).toEqual([4, 3, 2]);
  expect((await get("maxCents=10000")).ids).toEqual([5, 1]);
  expect((await get("from=2026-02-01&to=2026-03-20")).ids).toEqual([5, 3, 2]);
  const due = await get("dueFrom=2026-02-01&dueTo=2026-04-30"); // null due dates never match a due range
  expect(due.ids).toEqual([5, 1]);
  expect(due.total).toBe("2");
});

test("sorts", async () => {
  expect((await get("sort=oldest")).ids).toEqual([1, 2, 3, 4, 5]);
  expect((await get("sort=amount_desc")).ids).toEqual([4, 2, 3, 1, 5]);
  expect((await get("sort=amount_asc")).ids).toEqual([5, 1, 3, 2, 4]);
  expect((await get("sort=due_asc")).ids).toEqual([3, 1, 5, 4, 2]); // invoice 2 has no due date, so last
});

test("combined filters, paging and total", async () => {
  const r = await get("q=harbor&minCents=20000&sort=amount_asc&limit=1");
  expect(r.ids).toEqual([3]);
  expect(r.total).toBe("2");
  expect((await get("status=paid&q=acme")).ids).toEqual([]);
});

test("an employee searching still sees only their own invoices", async () => {
  expect((await get("q=harbor", 1)).ids).toEqual([5]);
  expect((await get("q=INV", 2)).ids).toEqual([]);
  expect((await get("", 2)).ids).toEqual([4, 3]);
});

test("LIKE wildcards in q are literal", async () => {
  expect((await get("q=%25")).ids).toEqual([3]); // only "100%_OFF" contains a real %
  expect((await get("q=_")).ids).toEqual([5, 4, 3]); // "_" in "100%_OFF" and "Blue_Harbor"; not every character
  expect((await get("q=INV_100")).ids).toEqual([]);
  expect((await get("q=%5C")).ids).toEqual([]); // backslash is literal too
});

test("bad input is a plain 400", async () => {
  for (const qs of [
    `q=${"a".repeat(101)}`, "vendorId=0", "vendorId=abc", "minCents=-1", "maxCents=1.5", "minCents=10&maxCents=5",
    "from=2026-13-01", "to=yesterday", "dueFrom=2026-02-30", "from=2026-05-01&to=2026-01-01", "dueFrom=2026-05-01&dueTo=2026-01-01", "sort=random",
  ]) {
    const { res } = await get(qs);
    expect(res.status, qs).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
  }
  expect((await get(`q=${"a".repeat(100)}`)).res.status).toBe(200);
});

test("an empty q or filter is ignored", async () => {
  expect((await get("q=%20&vendorId=")).ids).toEqual([5, 4, 3, 2, 1]);
});

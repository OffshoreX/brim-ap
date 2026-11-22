import { beforeEach, describe, expect, test } from "vitest";
import { GET as journal } from "@/app/api/export/journal/route";
import { getDb, resetDbForTests } from "./db";
import { allocate } from "./journal";
import { signSession } from "./session";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// 1 finance_manager, 2 controller_admin, 3 auditor, 4 employee, 5 ap_clerk, 6 approver
const ROLE_IDS = [[1, "finance_manager"], [2, "controller_admin"], [3, "auditor"], [4, "employee"], [5, "ap_clerk"], [6, "approver"]] as const;

beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  for (const [id, role] of ROLE_IDS) db.prepare("INSERT INTO users (id,name,role) VALUES (?,?,?)").run(id, role, role);
  db.exec(`
    INSERT INTO gl_accounts (id,code,name) VALUES (1,'1160','GST/HST Receivable'),(2,'1165','QST Receivable'),(3,'2100','Accounts Payable'),(4,'6110','Software'),(5,'5010','Freight');
    INSERT INTO tax_codes (code,rate_bps,recoverable,gl_account) VALUES ('HST13',1300,'yes','1160'),('GST5',500,'yes','1160'),('QST9975',997.5,'yes','1165'),('PST7_BC',700,'no',NULL),('FOREIGN',0,'n/a',NULL);
    INSERT INTO vendors (id,name) VALUES (1,'Acme, Inc'),(2,'=Evil Co');
  `);
});

type Inv = { id: number; status?: string; vendor?: number; date?: string; cur?: string; total: number; cad?: number | null; gst?: number; pst?: number; rate?: number };
function addInvoice(i: Inv, lines: [string, number, number | null, string | null, string?][]) {
  const db = getDb();
  db.prepare(
    `INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,total_cents,currency,total_cad_cents,fx_rate_to_cad_bps,gst_hst_cents,pst_qst_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(i.id, i.status ?? "approved", i.vendor ?? 1, `INV-${i.id}`, i.date ?? "2026-03-10", i.total, i.cur ?? "CAD", i.cad === undefined ? i.total : i.cad, i.rate ?? 10000, i.gst ?? 0, i.pst ?? 0);
  lines.forEach(([desc, cents, gl, gstCode, pstCode], n) =>
    db.prepare("INSERT INTO invoice_lines (invoice_id,line_no,description,amount_cents,unit_price_cents,currency,gl_account_id,gst_hst_code,pst_qst_code) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(i.id, n + 1, desc, cents, cents, i.cur ?? "CAD", gl, gstCode, pstCode ?? null)
  );
}

const get = (query: string, user = 1) => journal(new Request(`http://x/api/export/journal${query}`, { headers: { cookie: `session=${signSession(user)}` } }));
const RANGE = "?from=2026-01-01&to=2026-12-31";
type Row = Record<string, string>;
async function rows(query = RANGE, user = 1): Promise<Row[]> {
  const res = await get(query, user);
  expect(res.status).toBe(200);
  const [head, ...body] = (await res.text()).trimEnd().split("\r\n");
  const cols = head.split(",");
  // Test data has no commas except the vendor name, which is quoted; split on commas outside quotes.
  return body.map((l) => Object.fromEntries(l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, cols.length).map((c, i) => [cols[i], c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')])));
}
const cents = (s: string) => (s === "" ? 0 : Math.round(Number(s) * 100)); // test-side only: reads the decimal string back
const balanced = (rs: Row[]) => {
  for (const id of new Set(rs.map((r) => r.entry_id))) {
    const mine = rs.filter((r) => r.entry_id === id);
    expect(mine.reduce((a, r) => a + cents(r.debit) - cents(r.credit), 0), `${id} in original currency`).toBe(0);
    expect(mine.reduce((a, r) => a + cents(r.debit_cad) - cents(r.credit_cad), 0), `${id} in CAD`).toBe(0);
  }
};
const line = (rs: Row[], code: string, entry?: string) => rs.find((r) => r.account_code === code && (!entry || r.entry_id === entry))!;

describe("entries", () => {
  test("CAD invoice with HST: expense debit, recoverable tax debit, payables credit", async () => {
    addInvoice({ id: 1, total: 11300, gst: 1300 }, [["Hosting", 10000, 4, "HST13"]]);
    const rs = await rows();
    expect(rs.map((r) => [r.entry_id, r.account_code, r.debit, r.credit])).toEqual([
      ["JE-1", "6110", "100.00", ""], ["JE-1", "1160", "13.00", ""], ["JE-1", "2100", "", "113.00"],
    ]);
    expect(rs[0]).toMatchObject({ date: "2026-03-10", invoice_number: "INV-1", vendor: "Acme, Inc", account_name: "Software", currency: "CAD", memo: "Hosting", debit_cad: "100.00", credit_cad: "" });
    balanced(rs);
  });

  test("odd cents: HST over two lines still adds up to the cent", async () => {
    addInvoice({ id: 1, total: 3 * 3333 + 1300 + 0, gst: 1300 }, [["a", 3333, 4, "HST13"], ["b", 3333, 5, "HST13"], ["c", 3333, 4, "HST13"]]);
    const rs = await rows();
    expect(cents(line(rs, "1160").debit)).toBe(1300);
    balanced(rs);
  });

  test("QST goes to its own receivable account, GST and QST together", async () => {
    addInvoice({ id: 1, total: 11498, gst: 500, pst: 998 }, [["Rent", 10000, 4, "GST5", "QST9975"]]);
    const rs = await rows();
    expect(cents(line(rs, "1160").debit)).toBe(500);
    expect(cents(line(rs, "1165").debit)).toBe(998);
    balanced(rs);
  });

  test("non-recoverable PST is added to the expense, not to a receivable", async () => {
    addInvoice({ id: 1, total: 10700 + 500, gst: 500, pst: 700 }, [["Pallets", 10000, 5, "GST5", "PST7_BC"]]);
    const rs = await rows();
    expect(cents(line(rs, "5010").debit)).toBe(10700);
    expect(line(rs, "5010").memo).toContain("non-recoverable");
    expect(rs.some((r) => r.account_code === "1165")).toBe(false);
    balanced(rs);
  });

  test("USD invoice: original currency plus CAD from the stored rate, both sides balance", async () => {
    // 1234.57 USD at 1.3709 = 1692.5... stored CAD total is what the books use
    addInvoice({ id: 1, cur: "USD", total: 123457, cad: 169250, rate: 13709 }, [["Cloud", 100000, 4, "FOREIGN"], ["Support", 23457, 4, "FOREIGN"]]);
    const rs = await rows();
    expect(rs.every((r) => r.currency === "USD")).toBe(true);
    expect(line(rs, "2100").credit).toBe("1234.57");
    expect(line(rs, "2100").credit_cad).toBe("1692.50");
    expect(rs.filter((r) => r.account_code === "6110").reduce((a, r) => a + cents(r.debit_cad), 0)).toBe(169250);
    balanced(rs);
  });

  test("credit note: signs are reversed (payables debited, expense and tax credited)", async () => {
    addInvoice({ id: 1, total: -11300, gst: -1300 }, [["Refund", -10000, 4, "HST13"]]);
    const rs = await rows();
    expect(rs.map((r) => [r.account_code, r.debit, r.credit])).toEqual([["6110", "", "100.00"], ["1160", "", "13.00"], ["2100", "113.00", ""]]);
    balanced(rs);
  });

  test("paid invoice gets a second entry: payables debited, bank credited, dated by the payment", async () => {
    addInvoice({ id: 1, status: "paid", total: 11300, gst: 1300 }, [["Hosting", 10000, 4, "HST13"]]);
    getDb().prepare("INSERT INTO payments (id,invoice_id,amount_cents,currency,paid_at,status,reference) VALUES (7,1,11300,'CAD','2026-04-02T10:00:00.000Z','settled','PAY-7')").run();
    const rs = await rows();
    const pay = rs.filter((r) => r.entry_id === "JE-1-PAY-7");
    expect(pay.map((r) => [r.date, r.account_code, r.debit, r.credit])).toEqual([["2026-04-02", "2100", "113.00", ""], ["2026-04-02", "1010", "", "113.00"]]);
    expect(pay[0].memo).toBe("Payment PAY-7");
    balanced(rs);
  });

  test("paid with an early-pay discount: the discount is its own credit; two installments split a USD total exactly", async () => {
    addInvoice({ id: 1, status: "paid", total: 10000 }, [["x", 10000, 4, "FOREIGN"]]);
    addInvoice({ id: 2, status: "paid", cur: "USD", total: 10001, cad: 13717, rate: 13709 }, [["y", 10001, 4, "FOREIGN"]]);
    // Installments exist only in the dataset (ext_id set); payments made in the app are one per invoice.
    const ins = getDb().prepare("INSERT INTO payments (id,ext_id,invoice_id,amount_cents,discount_taken_cents,currency,paid_at,status) VALUES (?,'P'||?,?,?,?,?,?,'settled')");
    ins.run(1, 1, 1, 9800, 200, "CAD", "2026-04-02T10:00:00.000Z");
    ins.run(2, 2, 2, 3334, 0, "USD", "2026-04-02T10:00:00.000Z");
    ins.run(3, 3, 2, 3334, 0, "USD", "2026-04-09T10:00:00.000Z");
    ins.run(4, 4, 2, 3333, 0, "USD", "2026-04-16T10:00:00.000Z");
    const rs = await rows();
    expect(rs.filter((r) => r.entry_id === "JE-1-PAY-1").map((r) => [r.account_code, r.debit, r.credit])).toEqual([["2100", "100.00", ""], ["1010", "", "98.00"], ["7030", "", "2.00"]]);
    const aps = rs.filter((r) => r.account_code === "2100" && r.entry_id.startsWith("JE-2-PAY")).reduce((a, r) => a + cents(r.debit_cad), 0);
    expect(aps).toBe(13717); // the three installments clear exactly the invoice's CAD total
    balanced(rs);
  });

  test("a paid invoice with no settled payment gets only its invoice entry; scheduled and unpaid states behave", async () => {
    addInvoice({ id: 1, status: "paid", total: 100 }, [["a", 100, 4, "FOREIGN"]]);
    getDb().prepare("INSERT INTO payments (invoice_id,amount_cents,currency,paid_at,status) VALUES (1,100,'CAD',NULL,'outstanding')").run();
    addInvoice({ id: 2, status: "scheduled", total: 100 }, [["b", 100, 4, "FOREIGN"]]);
    addInvoice({ id: 3, status: "pending_approval", total: 100 }, [["c", 100, 4, "FOREIGN"]]);
    addInvoice({ id: 4, status: "rejected", total: 100 }, [["d", 100, 4, "FOREIGN"]]);
    expect([...new Set((await rows()).map((r) => r.entry_id))]).toEqual(["JE-1", "JE-2"]);
  });

  test("range: invoice date decides, both ends included, ordered by date", async () => {
    addInvoice({ id: 1, date: "2026-03-10", total: 100 }, [["a", 100, 4, "FOREIGN"]]);
    addInvoice({ id: 2, date: "2026-03-11", total: 100 }, [["b", 100, 4, "FOREIGN"]]);
    addInvoice({ id: 3, date: "2026-03-09", total: 100 }, [["c", 100, 4, "FOREIGN"]]);
    expect([...new Set((await rows("?from=2026-03-10&to=2026-03-11")).map((r) => r.entry_id))]).toEqual(["JE-1", "JE-2"]);
    expect((await rows("?from=2026-03-09&to=2026-03-09")).length).toBe(2);
  });

  test("text cells that start like a formula are neutralised and commas are quoted", async () => {
    addInvoice({ id: 1, vendor: 2, total: 100 }, [["=SUM(A1)", 100, 4, "FOREIGN"]]);
    const text = await (await get(RANGE)).text();
    expect(text).toContain("'=Evil Co");
    expect(text).toContain("'=SUM(A1)");
    addInvoice({ id: 2, total: 100 }, [["a", 100, 4, "FOREIGN"]]);
    expect(await (await get(RANGE)).text()).toContain('"Acme, Inc"');
  });
});

describe("empty and bad requests", () => {
  test("empty range gives the header row only, still audited", async () => {
    const res = await get(RANGE);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("journal-2026-01-01-to-2026-12-31.csv");
    expect(await res.text()).toBe("entry_id,date,invoice_number,vendor,account_code,account_name,debit,credit,currency,memo,debit_cad,credit_cad\r\n");
  });

  test.each([
    "", "?from=2026-01-01", "?to=2026-01-01", "?from=2026-1-1&to=2026-12-31", "?from=2026-02-30&to=2026-12-31", "?from=2026-12-31&to=2026-01-01", `${RANGE}&format=json`,
  ])("bad query %s -> 400, nothing audited", async (q) => {
    expect((await get(q)).status).toBe(400);
    expect(getDb().prepare("SELECT COUNT(*) n FROM audit_log WHERE action='journal.export'").get()).toEqual({ n: 0 });
  });

  test("format=csv is accepted", async () => {
    expect((await get(`${RANGE}&format=csv`)).status).toBe(200);
  });
});

describe("roles and audit", () => {
  test("finance_manager, controller_admin and auditor may export; everyone else gets 403 and no audit row", async () => {
    for (const u of [1, 2, 3]) expect((await get(RANGE, u)).status).toBe(200);
    for (const u of [4, 5, 6]) expect((await get(RANGE, u)).status).toBe(403);
    expect((await journal(new Request(`http://x/api/export/journal${RANGE}`))).status).toBe(401);
    expect(getDb().prepare("SELECT COUNT(*) n FROM audit_log WHERE action='journal.export'").get()).toEqual({ n: 3 });
  });

  test("the audit row says who exported which range and how much", async () => {
    addInvoice({ id: 1, status: "paid", total: 100 }, [["a", 100, 4, "FOREIGN"]]);
    getDb().prepare("INSERT INTO payments (invoice_id,amount_cents,currency,paid_at,status) VALUES (1,100,'CAD','2026-04-02T10:00:00.000Z','settled')").run();
    await get("?from=2026-03-01&to=2026-03-31", 3);
    const r = getDb().prepare("SELECT actor_id, entity, entity_id, after FROM audit_log WHERE action='journal.export'").get() as { actor_id: number; entity: string; entity_id: string; after: string };
    expect(r).toMatchObject({ actor_id: 3, entity: "journal", entity_id: "2026-03-01..2026-03-31" });
    expect(JSON.parse(r.after)).toEqual({ from: "2026-03-01", to: "2026-03-31", format: "csv", invoices: 1, entries: 2, rows: 4 });
  });
});

describe("never a wrong file", () => {
  const failure = async () => {
    const res = await get(RANGE);
    expect(res.status).toBe(500);
    expect(getDb().prepare("SELECT COUNT(*) n FROM audit_log WHERE action='journal.export'").get()).toEqual({ n: 0 });
    return (await res.json()) as { error: string; invoiceId: number };
  };

  test("an entry that does not balance (lines do not add up to the total) -> 500 with the invoice id", async () => {
    addInvoice({ id: 1, total: 100 }, [["fine", 100, 4, "FOREIGN"]]);
    addInvoice({ id: 2, total: 12345, gst: 1300 }, [["short", 10000, 4, "HST13"]]); // lines + tax = 11300, total says 12345
    const body = await failure();
    expect(body.invoiceId).toBe(2);
    expect(body.error).toMatch(/does not balance/);
  });

  test("a line with no account, an unknown tax code, or tax with no code -> 500 naming the invoice", async () => {
    addInvoice({ id: 5, total: 100 }, [["x", 100, null, "FOREIGN"]]);
    expect((await failure()).invoiceId).toBe(5);
    getDb().exec("DELETE FROM invoice_lines; DELETE FROM invoices");
    addInvoice({ id: 6, total: 113, gst: 13 }, [["x", 100, 4, "NOPE"]]);
    expect((await failure()).error).toMatch(/unknown tax code/);
    getDb().exec("DELETE FROM invoice_lines; DELETE FROM invoices");
    addInvoice({ id: 7, total: 113, gst: 13 }, [["x", 100, 4, null]]);
    expect((await failure()).invoiceId).toBe(7);
  });

  test("a USD invoice with no CAD total and no rate -> 500", async () => {
    addInvoice({ id: 8, cur: "USD", total: 100, cad: null }, [["x", 100, 4, "FOREIGN"]]);
    getDb().prepare("UPDATE invoices SET fx_rate_to_cad_bps = NULL").run();
    expect((await failure()).invoiceId).toBe(8);
  });
});

describe("allocate", () => {
  test("parts always add up to the target, for any sign", () => {
    for (const [target, weights] of [[1300, [3333, 3333, 3333]], [-1300, [-3333, -3333, -3333]], [100, [1, 1, 1]], [7, [5, -2, 4]], [0, [0, 0]], [10, [0, 5]]] as [number, number[]][])
      expect(allocate(target, weights).reduce((a, b) => a + b, 0)).toBe(target);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(() => allocate(5, [1, -1])).toThrow();
  });
});

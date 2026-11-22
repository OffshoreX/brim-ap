import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExtractedInvoice } from "@/extract/extractInvoice";
import { POST as loginRoute } from "@/app/api/login/route";
import { POST as vendorsPost } from "@/app/api/vendors/route";
import { GET as vendorGet, PATCH as vendorPatch } from "@/app/api/vendors/[id]/route";
import { PATCH as userPatch } from "@/app/api/users/[id]/route";
import { GET as invoiceGet } from "@/app/api/invoices/[id]/route";
import { GET as processLogGet } from "@/app/api/invoices/[id]/process-log/route";
import { GET as trailGet } from "@/app/api/invoices/[id]/trail/route";
import { POST as decisionPost } from "@/app/api/invoices/[id]/decision/route";
import { POST as resolvePost } from "@/app/api/exceptions/[id]/resolve/route";
import { POST as processPost } from "@/app/api/invoices/[id]/process/route";
import { POST as releasePost } from "@/app/api/payments/release/route";
import { GET as usersGet } from "@/app/api/users/route";
import { GET as eftGet } from "@/app/api/payments/eft-file/route";
import { writeAudit } from "./audit";
import { handle } from "./authz";
import { MAX_BODY_BYTES } from "./body";
import { csvCell } from "./csv";
import { getDb, resetDbForTests } from "./db";
import { classifyEmail, importInbox, parseBankText, senderLookalike } from "./inbox";
import { attemptLogin, clientIp } from "./login";
import { createLimiter } from "./loginLimiter";
import { hashPassword } from "./password";
import { exactKey, looseKey, matchVendor } from "./rules/vendorMatch";
import { cleanDeep, hasMixedScripts, lookalikes, stripBidi } from "./rules/unicode";
import { toCsv } from "./reports";
import { signSession } from "./session";

// No network: the extractor is replaced (used by the lookalike-vendor test only).
vi.mock("@/extract/extractInvoice", () => ({ extractInvoice: vi.fn() }));
import { extractInvoice } from "@/extract/extractInvoice";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

// 1 employee (requester), 2 other employee, 3 approver on the chain, 4 approver NOT on the chain, 5 clerk, 6 finance, 7 controller, 8 auditor
const [EMP, EMP2, APPR, APPR2, CLERK, FIN, CTRL, AUD] = [1, 2, 3, 4, 5, 6, 7, 8];
const ROLES = ["employee", "employee", "approver", "approver", "ap_clerk", "finance_manager", "controller_admin", "auditor"];
const FAKE_PW = "pw-for-tests-only";

beforeEach(() => {
  resetDbForTests();
  const db = getDb();
  ROLES.forEach((role, i) => db.prepare("INSERT INTO users (id,name,email,role,password_hash) VALUES (?,?,?,?,?)").run(i + 1, `User ${i + 1}`, `u${i + 1}@x.example`, role, hashPassword(FAKE_PW)));
  db.exec(`
    INSERT INTO vendors (id,name,ap_contact_email,status) VALUES (1,'Pacific Fuel','ap@pacificfuel.example','active');
    INSERT INTO invoices (id,status,vendor_id,invoice_number,invoice_date,total_cents,currency,requester_id) VALUES (10,'pending_approval',1,'A-1','2026-01-01',1000,'CAD',1);
    INSERT INTO approval_steps (invoice_id,step_no,role,user_id,status) VALUES (10,1,'dept_manager',3,'pending');
  `);
});
afterEach(() => vi.unstubAllEnvs());

const cookie = (u: number) => `session=${signSession(u)}`;
const req = (url: string, user: number | null, method = "GET", body?: string, headers: Record<string, string> = {}) =>
  new Request(url, { method, body, headers: { ...(user ? { cookie: cookie(user) } : {}), ...headers } });
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const timed = (fn: () => unknown) => { const t = performance.now(); fn(); return performance.now() - t; };

// ---- 1. Spoofed IP header -------------------------------------------------------------------------------------------
describe("1. X-Forwarded-For", () => {
  const withXff = (xff: string) => new Request("http://x/api/login", { headers: { "x-forwarded-for": xff } });

  test("without TRUST_PROXY the header is ignored: rotating it does not reset the IP limit", () => {
    const limiter = createLimiter();
    const results = Array.from({ length: 7 }, (_, i) => // a different email AND a different forged address every time
      attemptLogin({ email: `nobody${i}@x.example`, password: "wrong", ip: clientIp(withXff(`10.0.0.${i}`)) }, limiter).status);
    expect(results).toEqual([401, 401, 401, 401, 401, 429, 429]);
  });

  test("with TRUST_PROXY=1 the address our proxy appended (the last entry) is used", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    expect(clientIp(withXff("6.6.6.6, 7.7.7.7"))).toBe("7.7.7.7");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});

// ---- 2. ReDoS ---------------------------------------------------------------------------------------------------------
describe("2. regexes on untrusted text stay fast on 50,000 characters", () => {
  const evil = ["a".repeat(50_000), "send ".repeat(10_000), "pay ".repeat(12_500), "1".repeat(50_000), "account ".repeat(6_250), "new bank ".repeat(5_556), "é".repeat(50_000), ". ".repeat(25_000)];
  test.each(evil.map((s, i) => [i, s] as const))("string %i", (_, s) => {
    const ms = timed(() => {
      classifyEmail({ email_id: "1", from_address: "a@b.example", subject: s, body: s, attachments: [] });
      classifyEmail({ email_id: "2", from_address: "a@b.example", subject: "", body: s, attachments: ["x.pdf"] }, [1]);
      parseBankText(s);
      exactKey(s); looseKey(s);
      matchVendor(s, [{ id: 1, name: "Acme Inc" }], s);
      hasMixedScripts(s);
    });
    expect(ms).toBeLessThan(100);
  });
  test("a long body is cut before matching, so words past the cap are not read", () => {
    const body = "x ".repeat(15_000) + " please wire to the new bank account";
    expect(classifyEmail({ email_id: "1", from_address: "a@b.example", subject: "hi", body, attachments: [] }).class).toBe("marketing");
  });
});

// ---- 3. Input length caps ----------------------------------------------------------------------------------------------
describe("3. length caps", () => {
  const post = (route: typeof vendorsPost, body: unknown) => route(req("http://x/api/vendors", CLERK, "POST", JSON.stringify(body)));
  test("a name over 200, an email over 254 and a note over 2000 are each a 400; the limit itself passes", async () => {
    expect((await post(vendorsPost, { name: "N".repeat(201) })).status).toBe(400);
    expect((await post(vendorsPost, { name: "Ok", ap_contact_email: `${"a".repeat(250)}@b.co` })).status).toBe(400);
    const decide = (comment: string) => decisionPost(req("http://x", APPR, "POST", JSON.stringify({ decision: "rejected", comment })), ctx(10));
    expect((await decide("c".repeat(2001))).status).toBe(400);
    expect((await decide("c".repeat(2000))).status).toBe(200);
  });
  test("login: an email over 254 characters is a 400", async () => {
    const r = await loginRoute(req("http://x/api/login", null, "POST", JSON.stringify({ email: `${"a".repeat(255)}@x.example`, password: "x" })));
    expect(r.status).toBe(400);
  });
  test("a JSON body over 1 MB is a 413, by header or by size", async () => {
    const big = JSON.stringify({ note: "x".repeat(MAX_BODY_BYTES + 1) });
    expect((await vendorsPost(req("http://x/api/vendors", CLERK, "POST", big))).status).toBe(413);
    expect((await vendorsPost(req("http://x/api/vendors", CLERK, "POST", "{}", { "content-length": String(MAX_BODY_BYTES + 1) }))).status).toBe(413);
  });
});

// ---- 4. Object-level access ---------------------------------------------------------------------------------------------
describe("4. a role that cannot see the object gets the same answer as for an id that does not exist", () => {
  const same = async (call: (id: number) => Promise<Response>, status: number) => {
    const [real, missing] = [await call(10), await call(9999)];
    expect(real.status).toBe(status);
    expect([real.status, await real.json()]).toEqual([missing.status, await missing.json()]); // identical, so existence is not revealed
  };
  test("employee asking for another person's invoice: 404, with no data", async () => {
    await same((id) => invoiceGet(req("http://x", EMP2), ctx(id)), 404);
    await same((id) => processLogGet(req("http://x", EMP2), ctx(id)), 404);
    expect((await invoiceGet(req("http://x", EMP), ctx(10))).status).toBe(200); // the requester still sees it
  });
  test("an approver with no step on the invoice: 404 on detail, process log and decision", async () => {
    await same((id) => invoiceGet(req("http://x", APPR2), ctx(id)), 404);
    await same((id) => processLogGet(req("http://x", APPR2), ctx(id)), 404);
    await same((id) => decisionPost(req("http://x", APPR2, "POST", JSON.stringify({ decision: "approved" })), ctx(id)), 404);
    expect((await invoiceGet(req("http://x", APPR), ctx(10))).status).toBe(200); // the one on the chain still sees it
  });
  test("routes closed to a role answer the same for every id (403), so they confirm nothing", async () => {
    await same((id) => trailGet(req("http://x", EMP2), ctx(id)), 403);
    await same((id) => trailGet(req("http://x", APPR2), ctx(id)), 403);
    await same((id) => vendorGet(req("http://x", EMP2), ctx(id)), 403);
    await same((id) => processPost(req("http://x", APPR2, "POST"), ctx(id)), 403);
    await same((id) => resolvePost(req("http://x", EMP2, "POST", JSON.stringify({ action: "reject", note: "n" })), ctx(id)), 403);
    await same((id) => userPatch(req("http://x", CLERK, "PATCH", JSON.stringify({ role: "auditor" })), ctx(id)), 403);
    await same((id) => releasePost(req("http://x", APPR2, "POST", JSON.stringify({ paymentId: id }))), 403);
  });
});

// ---- 5. Prototype pollution -----------------------------------------------------------------------------------------------
describe("5. prototype pollution", () => {
  const raw = '{"__proto__": {"role": "controller_admin"}}'; // a string, so JSON.parse makes __proto__ an own key
  test.each(["__proto__", "constructor", "prototype"])("%s in a PATCH or POST body is a 400 and nothing changes", async (key) => {
    const body = `{"${key}": {"role": "controller_admin"}}`;
    expect((await userPatch(req("http://x", CTRL, "PATCH", body), ctx(CLERK))).status).toBe(400);
    expect((await vendorPatch(req("http://x", CLERK, "PATCH", body), ctx(1))).status).toBe(400);
    expect((await vendorsPost(req("http://x", CLERK, "POST", `{"name":"Fine Co","x":${body}}`))).status).toBe(400);
    expect(({} as Record<string, unknown>).role).toBeUndefined();
    expect(getDb().prepare("SELECT role FROM users WHERE id = ?").get(CLERK)).toEqual({ role: "ap_clerk" });
  });
  test("the pollution body is also refused when mixed with a real edit", async () => {
    expect((await userPatch(req("http://x", CTRL, "PATCH", `{"status":"active", ${raw.slice(1)}`), ctx(CLERK))).status).toBe(400);
  });
});

// ---- 6. Random tokens -------------------------------------------------------------------------------------------------------
test("6. Math.random appears nowhere in src except the login timing dummy", () => {
  const hits: string[] = [];
  const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && fs.readFileSync(p, "utf8").includes("Math.random")) hits.push(path.relative(process.cwd(), p));
  });
  walk(path.join(process.cwd(), "src"));
  expect(hits).toEqual(["src/server/login.ts"]);
});

// ---- 7. Login enumeration ------------------------------------------------------------------------------------------------------
test("7. unknown email and wrong password get the same status and text", async () => {
  const login = (email: string) => loginRoute(req("http://x/api/login", null, "POST", JSON.stringify({ email, password: "wrong-password" })));
  const [unknown, wrong] = [await login("nobody@x.example"), await login("u5@x.example")];
  expect([unknown.status, await unknown.json()]).toEqual([wrong.status, await wrong.json()]);
  expect(unknown.status).toBe(401);
});

// ---- 8. CSV formula injection -----------------------------------------------------------------------------------------------------
describe("8. CSV", () => {
  test("cells starting with = + - @ tab or CR are neutralised; plain numbers are left alone", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) expect(csvCell(`${lead}HYPERLINK("http://evil.example","x")`)).toMatch(/^"?'/);
    expect(csvCell("-12.34")).toBe("-12.34");
    expect(csvCell("Acme, Inc")).toBe('"Acme, Inc"');
    expect(toCsv([{ v: "\tcmd" }, { v: "\rcmd" }], ["v"])).toContain("'\tcmd");
  });
  test("the EFT file neutralises a vendor named =HYPERLINK(...)", async () => {
    const db = getDb();
    db.prepare("UPDATE vendors SET name = ? WHERE id = 1").run('=HYPERLINK("http://evil.example","pay")');
    db.prepare("INSERT INTO payments (invoice_id,amount_cents,currency,method,status,reference) VALUES (10,1000,'CAD','EFT','settled','PAY-1')").run();
    const text = await (await eftGet(req("http://x", FIN))).text();
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""pay"")"`);
    expect(text).not.toMatch(/,=HYPERLINK/);
  });
});

// ---- 9. Unicode ------------------------------------------------------------------------------------------------------------------------
describe("9. Unicode", () => {
  const fake = "Pаcific Fuel"; // the "а" is Cyrillic U+0430
  const vendors = [{ id: 1, name: "Pacific Fuel" }];

  test('"Pacific Fuel" with a Cyrillic a is mixed-script and reads like the real vendor', () => {
    expect(fake).not.toBe("Pacific Fuel");
    expect(hasMixedScripts(fake)).toBe(true);
    expect(hasMixedScripts("Pacific Fuel")).toBe(false);
    expect(hasMixedScripts("Москва Транс")).toBe(false); // a wholly Cyrillic name is not mixed
    expect(lookalikes(fake, vendors, exactKey).map((v) => v.id)).toEqual([1]);
    expect(lookalikes("Pacific Fuel", vendors, exactKey)).toEqual([]); // the real spelling is not flagged
  });
  test("matching uses NFKC: a fullwidth name finds the plain vendor", () => {
    expect(matchVendor("ＰＡＣＩＦＩＣ Ｆｕｅｌ", vendors)).toEqual({ status: "matched", id: 1, by: "exact_name" });
    expect(matchVendor(fake, vendors).status).toBe("none"); // never matched by guess
  });
  test("creating a vendor with the lookalike spelling is refused", async () => {
    const res = await vendorsPost(req("http://x/api/vendors", CLERK, "POST", JSON.stringify({ name: fake })));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/looks like the existing vendor "Pacific Fuel"/);
  });
  test("an invoice naming the lookalike vendor is flagged with a warning and an error (unmatched)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweep2-"));
    const file = path.join(dir, "a.pdf");
    fs.writeFileSync(file, "%PDF-1.4 x");
    const id = Number(getDb().prepare("INSERT INTO invoices (status,invoice_number,invoice_date,total_cents,currency,requester_id,source_file) VALUES ('received','','',0,'CAD',1,?)").run(file).lastInsertRowid);
    const invoice: ExtractedInvoice = {
      vendorName: fake, invoiceNumber: "Z-1", invoiceDate: "2026-11-01", dueDate: null, currency: "CAD",
      lines: [{ description: "Fuel‮evil", quantity: "1", unitPriceCents: 1000, amountCents: 1000 }],
      taxes: [], totalCents: 1000, poNumber: null, bankDetails: null, language: "en",
    };
    vi.mocked(extractInvoice).mockResolvedValue({ status: "ok", invoice, cached: false });
    const res = await processPost(req("http://x", CLERK, "POST"), ctx(id));
    const codes = ((await res.json()).flags as { code: string }[]).map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["vendor_name_mixed_scripts", "vendor_lookalike", "vendor_unmatched"]));
    expect(JSON.stringify(getDb().prepare("SELECT lines.description FROM invoice_lines lines WHERE invoice_id = ?").all(id))).not.toContain("‮");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test("a sender domain that mixes alphabets, or copies a vendor's domain, is flagged", () => {
    const known = ["pacificfuel.example"];
    expect(senderLookalike("ap@pасificfuel.example", known)).toMatch(/mixes alphabets/); // Cyrillic "а" and "с" among Latin letters
    expect(senderLookalike("ap@расе.example", ["pace.example"])).toMatch(/looks like the vendor domain "pace.example"/); // "расе" is all Cyrillic, so not mixed, but it reads as "pace"
    expect(senderLookalike("ap@pacificfuel.example", known)).toBeNull();
    expect(senderLookalike("ap@other.example", known)).toBeNull();
  });
  test("an imported email from a lookalike sender is flagged and its sender is stored in NFKC form", () => {
    const [r] = importInbox({ id: CLERK } as never, [{ email_id: "E1", from_address: "ＡＰ@pacificfuel.example", subject: "Hi‮there", body: "hello", attachments: [] }]);
    const row = getDb().prepare("SELECT from_address, subject FROM inbox_mail WHERE email_id = 'E1'").get() as { from_address: string; subject: string };
    expect(row).toEqual({ from_address: "AP@pacificfuel.example", subject: "Hithere" });
    expect(r.flags).toEqual([]);
    const [fake2] = importInbox({ id: CLERK } as never, [{ email_id: "E2", from_address: "ap@pacificfuеl.example", subject: "Invoice", body: "x", attachments: [] }]);
    expect(fake2.flags.join()).toMatch(/sender_lookalike/);
  });
  test("bidi controls are removed from text stored in the audit log", () => {
    expect(stripBidi("a\u202Ab\u202Ec\u2066d\u2069e")).toBe("abcde");
    expect(cleanDeep({ a: ["x\u202Ey"], n: 3 })).toEqual({ a: ["xy"], n: 3 });
    writeAudit({ actorId: CTRL, action: "test.bidi", entity: "invoice", entityId: 10, after: { note: "pay\u202Eevil" } });
    expect((getDb().prepare("SELECT after FROM audit_log WHERE action = 'test.bidi'").get() as { after: string }).after).toBe('{"note":"payevil"}');
  });
});

// ---- Cache-Control ----------------------------------------------------------------------------------------------------------------------
test("every API answer, success or error, says Cache-Control: no-store", async () => {
  expect((await handle(() => Response.json({ ok: true }))).headers.get("cache-control")).toBe("no-store");
  expect((await handle(() => { throw new Error("boom"); })).headers.get("cache-control")).toBe("no-store");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const login = await loginRoute(req("http://x/api/login", null, "POST", "{}"));
  expect(login.headers.get("cache-control")).toBe("no-store");
  expect((await invoiceGet(req("http://x", null), ctx(10))).headers.get("cache-control")).toBe("no-store"); // a 401 too
  expect(usersGet(req("http://x", CTRL)).headers.get("cache-control")).toBe("no-store"); // the one route that answers without handle()
});

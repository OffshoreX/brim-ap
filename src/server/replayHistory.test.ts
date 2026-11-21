import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { importDataset } from "./importDataset";
import { replayHistory, listHistoricalAnomalies } from "./replayHistory";
import { signSession } from "./session";
import { GET as historical } from "@/app/api/exceptions/historical/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

beforeEach(() => {
  resetDbForTests();
  importDataset(getDb());
});

const tables = ["invoices", "approvals", "approval_steps", "payments", "audit_log"];
const snapshot = () => tables.map((t) => (getDb().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n);

test("the replay covers every imported invoice, approval and payment and writes nothing", () => {
  replayHistory(); // the first call seeds the approval-rule thresholds (existing behaviour, same as the live app); measure the second
  const before = snapshot();
  const r = replayHistory();
  const db = getDb();
  expect(r.invoices).toBe((db.prepare("SELECT count(*) n FROM invoices").get() as { n: number }).n);
  expect(r.approvals).toBe((db.prepare("SELECT count(*) n FROM approvals").get() as { n: number }).n);
  expect(r.payments).toBe((db.prepare("SELECT count(*) n FROM payments").get() as { n: number }).n);
  expect(snapshot()).toEqual(before); // read-only: no status change, no audit row
});

test("each cause has a count, a verdict and at most 3 example invoices", () => {
  const { causes } = replayHistory();
  for (const c of causes) {
    expect(c.count).toBeGreaterThan(0);
    expect(c.examples.length).toBeLessThanOrEqual(3);
    expect(["control_failure", "rule_ok"]).toContain(c.verdict);
    expect(c.why.length).toBeGreaterThan(0);
  }
});

test("a rule we trust is never reported as a flagged anomaly, and a control failure is", () => {
  const { causes } = replayHistory();
  const { items, total } = listHistoricalAnomalies({ limit: 1000, offset: 0 });
  const failures = causes.filter((c) => c.verdict === "control_failure").reduce((n, c) => n + c.count, 0);
  expect(total).toBe(failures);
  expect(items.length).toBe(total);
  expect(items.every((i) => i.readOnly && i.reason.length > 0)).toBe(true);
  const okCodes = new Set(causes.filter((c) => c.verdict === "rule_ok").map((c) => c.code));
  expect(items.some((i) => okCodes.has(i.code))).toBe(false);
});

test("a self-approval planted in the history is found (no ids in the rule)", () => {
  const db = getDb();
  const row = db.prepare("SELECT invoice_id, approver_id FROM approvals ORDER BY id LIMIT 1").get() as { invoice_id: number; approver_id: number };
  db.prepare("UPDATE invoices SET requester_id = ? WHERE id = ?").run(row.approver_id, row.invoice_id);
  const { items } = listHistoricalAnomalies({ limit: 1000, offset: 0 });
  expect(items.some((i) => i.invoiceId === row.invoice_id && i.code === "self_approval_not_escalated")).toBe(true);
});

test("a released payment above the releaser's tier is found", () => {
  const db = getDb();
  const p = db.prepare("SELECT p.id FROM payments p JOIN users u ON u.id = p.released_by WHERE u.role = 'finance_manager' LIMIT 1").get() as { id: number };
  db.prepare("UPDATE payments SET amount_cad_cents = 99999999999 WHERE id = ?").run(p.id); // only a controller may release this much
  const { items } = listHistoricalAnomalies({ limit: 1000, offset: 0 });
  expect(items.some((i) => i.paymentId === p.id && i.code === "released_above_limit")).toBe(true);
});

const get = (userId: number | null, query = "") =>
  historical(new Request(`http://x/api/exceptions/historical${query}`, { headers: userId === null ? {} : { cookie: `session=${signSession(userId)}` } }));
const userWithRole = (role: string) => (getDb().prepare("SELECT id FROM users WHERE role = ? LIMIT 1").get(role) as { id: number }).id;

test("the endpoint needs a session, refuses employees and approvers, lets the auditor read", async () => {
  expect((await get(null)).status).toBe(401);
  expect((await get(userWithRole("employee"))).status).toBe(403);
  expect((await get(userWithRole("approver"))).status).toBe(403);
  const res = await get(userWithRole("auditor"), "?limit=2");
  expect(res.status).toBe(200);
  expect((await res.json()).length).toBeLessThanOrEqual(2);
  expect(Number(res.headers.get("X-Total-Count"))).toBeGreaterThanOrEqual(0);
  expect((await get(userWithRole("ap_clerk"), "?limit=0")).status).toBe(400);
});

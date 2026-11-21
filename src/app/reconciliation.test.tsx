// Login and reconciliation smoke tests with fetch mocked: lockout text, demo panel gating, 403 and CSV download.
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

let users: { data?: unknown } = {};
let summary: { data?: unknown; error?: string } = {};
const asked: (string | null)[] = [];
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/components/api", async (orig) => ({
  ...(await orig<typeof import("@/components/api")>()),
  useApi: (url: string | null) => {
    asked.push(url);
    return url === "/api/users" ? users : summary;
  },
}));

import { call, download, post } from "@/components/api";
import { asRole } from "@/components/asRole";
import ReconCard from "@/components/ReconCard";
import Login from "./login/page";
import Reconciliation from "./reconciliation/page";

afterEach(() => { vi.unstubAllGlobals(); asked.length = 0; users = {}; summary = {}; });

test("login: no Demo panel when the server hides the user list", () => {
  const html = renderToString(<Login />);
  expect(html).toContain("Password");
  expect(html).not.toContain("Demo");
});

test("login: Demo panel appears when the server lists the personas", () => {
  users = { data: { users: [{ id: 1, name: "Priya", role: "controller_admin" }] } };
  const html = renderToString(<Login />);
  expect(html).toContain("Demo");
  expect(html).toContain("Priya");
});

test("login: a 429 lockout keeps the server's wait text", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Too many failed attempts. Try again in 10 minutes." }), { status: 429 }));
  expect((await post("/api/login", { email: "a@b.c", password: "x" })).error).toContain("10 minutes");
});

test("reconciliation: 403 shows the server's message instead of tables", () => {
  summary = { error: "Not allowed: Forbidden" };
  const html = renderToString(<Reconciliation />);
  expect(html).toContain("Not allowed: Forbidden");
  expect(html).not.toContain("Matched");
});

test("reconciliation: counters render once the summary loads", () => {
  summary = { data: { summary: { matched: 393, payment_unmatched: 1, payment_ambiguous: 0, amount_diff: 3, duplicate: 0, bank_no_payment: 0, card_no_payment: 6 } } };
  const html = renderToString(<Reconciliation />);
  expect(html).toContain("393");
  expect(html).toContain("Unmatched bank lines");
});

test("dashboard card only asks the server for roles that may read it", () => {
  expect(renderToString(asRole("employee", <ReconCard />))).toBe("");
  expect(asked).not.toContain("/api/reconciliation?limit=1");
  summary = { data: { summary: { matched: 5, payment_unmatched: 1, payment_ambiguous: 0, amount_diff: 2, duplicate: 0, bank_no_payment: 0, card_no_payment: 0 } } };
  const html = renderToString(asRole("auditor", <ReconCard />));
  expect(html).toContain("Reconciled payments");
  expect(html).toContain("<strong>3</strong>");
});

test("CSV download turns a 403 into a message", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
  expect(await download("/api/reconciliation?format=csv", "reconciliation.csv")).toBe("Not allowed: Forbidden");
  expect((await call("/api/reconciliation")).error).toBe("Not allowed: Forbidden");
});

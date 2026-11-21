// The audit rows show names and one-line summaries; the JSON stays in an expander.
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { AuditTable, summarise } from "./AuditTable";

test("summaries are one short line", () => {
  expect(summarise(null)).toBe("—");
  expect(summarise({ status: "needs_review", total: 100 })).toBe("status: needs review, total: 100");
  expect(summarise({ note: "x".repeat(200) }).length).toBeLessThanOrEqual(60);
});

test("rows show the actor name, system for none, words for the action, and the JSON in a details element", () => {
  const rows = [
    { id: 1, at: "2026-11-20T10:00:00Z", actorId: 4, actorName: "Dana Clerk", action: "invoice.approved", entity: "invoice", entityId: "9", before: { status: "pending_approval" }, after: { status: "approved" } },
    { id: 2, at: "2026-11-20T10:01:00Z", actorId: null, actorName: "System", action: "inbox.import", entity: "inbox_mail", entityId: "e1", before: null, after: null },
  ];
  const html = renderToString(<AuditTable rows={rows} entity />).replaceAll("<!-- -->", "");
  expect(html).toContain("Dana Clerk");
  expect(html).toContain("System");
  expect(html).toContain("Invoice approved");
  expect(html).not.toContain("invoice.approved");
  expect(html).toContain("<details");
});

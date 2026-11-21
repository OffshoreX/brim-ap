// Rows render from a mocked response, polling stops at a final status, and the empty state points to Upload.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

let data: unknown = [];
vi.mock("@/components/api", async (orig) => ({
  ...(await orig<typeof import("@/components/api")>()),
  Load: ({ children }: { children: (d: unknown, reload: () => void) => ReactNode }) => children(data, () => {}),
}));

import ActivityPage from "@/app/activity/page";
import { followSteps, StepsTable, type StepRow } from "./ProcessSteps";

const rows: StepRow[] = [
  { id: 2, step: "duplicates", status: "flagged", detail: "Same vendor, number and total as invoice 4", durationMs: 12, createdAt: "2026-11-21 10:00:02", invoiceId: 9, invoiceNumber: "A-1" },
  { id: 1, step: "extract", status: "ok", detail: "Called the model; schema validation passed", durationMs: 1500, createdAt: "2026-11-21 10:00:01", invoiceId: 9, invoiceNumber: "A-1" },
  { id: 3, step: "po_match", status: "skipped", detail: "No contract on file", durationMs: 0, createdAt: "2026-11-21 10:00:03", invoiceId: 9, invoiceNumber: "A-1" },
  { id: 4, step: "bank", status: "failed", detail: "Could not compare", durationMs: 3, createdAt: "2026-11-21 10:00:04", invoiceId: 9, invoiceNumber: "A-1" },
];

test("each row shows time, step, status word, sentence and duration; flagged and failed rows say Reason", () => {
  const html = renderToString(<StepsTable rows={rows} withInvoice />).replaceAll("<!-- -->", "");
  for (const text of ["10:00:02", "Look for duplicates", "Flagged", "OK", "Skipped", "Failed", "Reason: </strong>Same vendor", "12 ms", "1.5 s", "Invoice A-1"]) expect(html).toContain(text);
  expect(html).toContain('href="/invoices/9"');
  expect(html).not.toContain("Reason: </strong>Called the model");
});

function follow(status: string, statuses: string[]) {
  const reads = { steps: 0, status: 0 };
  const shown: StepRow[][] = [];
  return {
    reads, shown,
    run: () => followSteps(status, {
      getSteps: async () => { reads.steps++; return rows.slice(0, reads.steps); },
      getStatus: async () => statuses[reads.status++],
      wait: async () => {},
      onSteps: (r) => shown.push(r),
      onError: () => {},
      cancelled: () => false,
    }),
  };
}

test("polling keeps reading while the invoice is received and stops once it is needs_review", async () => {
  const f = follow("received", ["received", "needs_review"]);
  await f.run();
  expect(f.reads.steps).toBe(3); // read, still received, read, still received, read, needs_review, stop
  expect(f.shown.at(-1)).toHaveLength(3);
});

test("an invoice that is already final is read once and not polled", async () => {
  const f = follow("pending_approval", []);
  await f.run();
  expect(f.reads).toEqual({ steps: 1, status: 0 });
});

test("a read error is reported and polling carries on", async () => {
  const errors: string[] = [];
  let n = 0;
  await followSteps("received", {
    getSteps: async () => (++n === 1 ? "Could not reach the server." : rows),
    getStatus: async () => "pending_approval", wait: async () => {}, onSteps: () => {}, onError: (m) => errors.push(m), cancelled: () => false,
  });
  expect(errors).toEqual(["Could not reach the server."]);
  expect(n).toBe(2);
});

test("activity page: rows link to their invoice, a status with no rows and an empty log each say so", () => {
  data = rows;
  expect(renderToString(<ActivityPage />)).toContain("/invoices/9");
  data = [];
  const empty = renderToString(<ActivityPage />);
  expect(empty).toContain("Upload an invoice");
  expect(empty).toContain('href="/upload"');
});

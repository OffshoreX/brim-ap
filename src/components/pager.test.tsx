import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import Pager, { invoicesUrl } from "./Pager";

const html = (page: number, shown: number, total: number) => renderToString(<Pager page={page} shown={shown} total={total} onPage={() => {}} />);

test("first page of 426 says what is shown and disables Previous", () => {
  const h = html(1, 50, 426);
  expect(h).toContain("Showing 1 to 50 of 426");
  expect(h).toMatch(/<button[^>]*disabled[^>]*>Previous/);
  expect(h).not.toMatch(/<button[^>]*disabled[^>]*>Next/);
});

test("last page disables Next and counts only the rows it has", () => {
  const h = html(9, 26, 426);
  expect(h).toContain("Showing 401 to 426 of 426");
  expect(h).toMatch(/<button[^>]*disabled[^>]*>Next/);
  expect(h).not.toMatch(/<button[^>]*disabled[^>]*>Previous/);
});

test("a page past the end says none instead of a made-up range", () => {
  expect(html(99, 0, 426)).toContain("Showing none of 426");
});

test("the status filter and the page go to the server as a query", () => {
  expect(invoicesUrl("", 1)).toBe("/api/invoices?limit=50&offset=0");
  expect(invoicesUrl("needs_review", 3)).toBe("/api/invoices?limit=50&offset=100&status=needs_review");
});

import { test, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applySchema } from "./db";

const cols = (d: Database.Database, t: string) =>
  (d.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name);

test("new columns exist", () => {
  const d = new Database(":memory:");
  applySchema(d);
  expect(cols(d, "invoice_lines")).toContain("tax_cents");
  expect(cols(d, "invoices")).toEqual(expect.arrayContaining(["source_file", "extraction_json", "extracted_at"]));
});

test("a new db/*.sql file is picked up, after schema.sql", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-"));
  fs.writeFileSync(path.join(dir, "schema.sql"), "CREATE TABLE a (id INTEGER);");
  fs.writeFileSync(path.join(dir, "zz_extra.sql"), "CREATE TABLE b (a_id INTEGER REFERENCES a(id));");
  const d = new Database(":memory:");
  applySchema(d, dir);
  expect(cols(d, "b")).toEqual(["a_id"]);
});

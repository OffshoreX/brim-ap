import { afterAll, beforeAll, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applySchema } from "./db";
import { DatasetError, counts, importDataset, requiredColumns, validateFolder } from "./importDataset";

// Everything runs in a temp dir: the committed sample and data/app.db are never touched.
let tmp: string, good: string;
const run = (script: string, args: string[], dbFile?: string) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, ...(dbFile ? { DB_PATH: dbFile } : {}) } });
const copy = (name: string) => { const d = path.join(tmp, name); fs.cpSync(good, d, { recursive: true }); return d; };
const edit = (dir: string, file: string, f: (t: string) => string) => {
  const p = path.join(dir, "data", file);
  fs.writeFileSync(p, f(fs.readFileSync(p, "utf8")));
};

// Generated values never contain commas or quotes, so a plain split is enough to overwrite one cell. Row 1 is the header.
const setCell = (dir: string, file: string, row: number, col: string, value: string) =>
  edit(dir, file, (t) => {
    const lines = t.split("\n");
    const cells = lines[row - 1].split(",");
    cells[lines[0].split(",").indexOf(col)] = value;
    lines[row - 1] = cells.join(",");
    return lines.join("\n");
  });

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brim-import-"));
  good = path.join(tmp, "good");
  expect(run("scripts/make-demo-data.mjs", ["--out", good]).status).toBe(0);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("a generated folder imports, and the printed counts match the database", () => {
  const dbFile = path.join(tmp, "ok.db");
  const r = run("scripts/import-dataset.mjs", ["--dir", good, "--reset"], dbFile);
  expect(r.status, r.stderr).toBe(0);
  const printed = Object.fromEntries([...r.stdout.matchAll(/│ (\w+)\s+│ (\d+)\s+│/g)].map((m) => [m[1], Number(m[2])]));
  const d = new Database(dbFile);
  expect(printed).toEqual(counts(d));
  expect(printed).toMatchObject({ vendors: 8, users: 18, invoices: 30 });
  // 3 users per role
  expect(d.prepare("SELECT role, count(*) n FROM users GROUP BY role").all().map((x) => (x as { n: number }).n)).toEqual([3, 3, 3, 3, 3, 3]);
  expect(d.pragma("foreign_key_check")).toEqual([]);
  d.close();
});

test("--reset rebuilds the database instead of adding to it", () => {
  const dbFile = path.join(tmp, "reset.db");
  expect(run("scripts/import-dataset.mjs", ["--dir", good], dbFile).status).toBe(0);
  const d = new Database(dbFile);
  d.prepare("INSERT INTO audit_log (action, entity) VALUES ('marker','x')").run();
  d.close();
  expect(run("scripts/import-dataset.mjs", ["--dir", good, "--reset"], dbFile).status).toBe(0);
  const after = new Database(dbFile);
  expect(after.prepare("SELECT count(*) n FROM audit_log WHERE action='marker'").get()).toEqual({ n: 0 });
  after.close();
});

test("a missing column is named, and nothing is written", () => {
  const dir = copy("bad-col");
  edit(dir, "invoices.csv", (t) => t.replace("subtotal,", "sub_total,"));
  expect(validateFolder(dir)).toEqual(['invoices.csv has no column named "subtotal".']);
  const d = new Database(":memory:");
  applySchema(d);
  expect(() => importDataset(d, path.join(dir, "data"))).toThrow(DatasetError);
  expect(Object.values(counts(d)).every((n) => n === 0)).toBe(true);
  // the CLI refuses too, and does not even create the database file
  const dbFile = path.join(tmp, "never.db");
  const r = run("scripts/import-dataset.mjs", ["--dir", dir, "--reset"], dbFile);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('invoices.csv has no column named "subtotal"');
  expect(fs.existsSync(dbFile)).toBe(false);
});

test("a duplicate id is reported with its rows, and nothing is written", () => {
  const dir = copy("dup-id");
  edit(dir, "vendors.csv", (t) => { const lines = t.trim().split("\n"); return [...lines, lines[1]].join("\n") + "\n"; });
  expect(validateFolder(dir)).toEqual(['vendors.csv row 10: vendor_id "V001" was already used on row 2.']);
  const d = new Database(":memory:");
  applySchema(d);
  expect(() => importDataset(d, path.join(dir, "data"))).toThrow(/already used on row 2/);
  expect(Object.values(counts(d)).every((n) => n === 0)).toBe(true);
});

test("bad money, a fake date, a dangling reference and a missing attachment each get a sentence with file and row", () => {
  const dir = copy("many");
  setCell(dir, "invoices.csv", 2, "subtotal", "7219.825");
  setCell(dir, "invoices.csv", 3, "invoice_date", "2026-02-30");
  setCell(dir, "invoice_lines.csv", 3, "invoice_id", "AP-99999");
  fs.writeFileSync(path.join(dir, "inbox", "emails.json"), JSON.stringify([{ email_id: "E1", from_address: "a@b.example", subject: "s", body: "b", attachments: ["nope.pdf"] }]));
  const text = validateFolder(dir).join("\n");
  expect(text).toMatch(/invoices\.csv row 2: could not read subtotal_cents \(bad decimal "7219\.825"/);
  expect(text).toContain('invoices.csv row 3: invoice_date "2026-02-30" is not a valid date');
  expect(text).toContain('invoice_lines.csv row 3: invoice_id "AP-99999" is not in invoices.csv.');
  expect(text).toContain('inbox/emails.json email 1: attachment "nope.pdf" is not in incoming_invoices/.');
});

test("the committed sample still validates, and the header comment lists every column", () => {
  expect(validateFolder("brim_ap_dataset")).toEqual([]);
  const script = fs.readFileSync("scripts/import-dataset.mjs", "utf8");
  for (const [file, cols] of Object.entries(requiredColumns())) expect(script).toContain(`//   ${file}: ${cols.join(", ")}`);
});

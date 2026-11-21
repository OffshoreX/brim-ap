import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { signSession } from "./session";
import { GET as list } from "@/app/api/invoices/route";
import { POST as upload } from "@/app/api/invoices/upload/route";

process.env.SESSION_SECRET = "test-secret";
process.env.DB_PATH = ":memory:";

const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("x")]);
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  process.env.UPLOAD_DIR = dir;
  resetDbForTests();
  getDb()
    .prepare(
      `INSERT INTO users (id,name,role) VALUES
       (1,'Emp1','employee'),(2,'Emp2','employee'),(3,'Clerk','ap_clerk'),(4,'Appr','approver'),
       (5,'Fin','finance_manager'),(6,'Admin','controller_admin'),(7,'Aud','auditor')`
    )
    .run();
});

const cookie = (u: number) => ({ cookie: `session=${signSession(u)}` });
const post = (u: number | null, ...files: Buffer[]) => {
  const form = new FormData();
  files.forEach((b, i) => form.append("file", new Blob([new Uint8Array(b)]), `f${i}`));
  return upload(new Request("http://x", { method: "POST", body: form, headers: u ? cookie(u) : {} }));
};
const ids = async (u: number) =>
  (await (await list(new Request("http://x", { headers: cookie(u) }))).json()).map((i: { id: number }) => i.id);

test("no cookie gets 401, finance_manager/approver/auditor cannot upload", async () => {
  expect((await post(null, pdf("a"))).status).toBe(401);
  for (const u of [4, 5, 7]) expect((await post(u, pdf("a"))).status).toBe(403);
  expect((await list(new Request("http://x"))).status).toBe(401);
});

test("upload stores file by hash, creates received invoice owned by uploader, audits", async () => {
  const res = await post(1, pdf("a"), png);
  expect(res.status).toBe(200);
  const out = await res.json();
  expect(out.map((r: { duplicate: boolean }) => r.duplicate)).toEqual([false, false]);
  const rows = getDb().prepare("SELECT * FROM invoices").all() as { status: string; requester_id: number; source_file: string }[];
  expect(rows.map((r) => [r.status, r.requester_id])).toEqual([["received", 1], ["received", 1]]);
  expect(fs.readdirSync(dir).map((f) => path.extname(f)).sort()).toEqual([".pdf", ".png"]);
  expect(getDb().prepare("SELECT * FROM audit_log WHERE action='invoice.upload'").all()).toHaveLength(2);
});

test("same bytes twice gives one invoice and one stored file", async () => {
  await post(1, pdf("a"));
  const out = await (await post(3, pdf("a"))).json();
  expect(out[0].duplicate).toBe(true);
  expect(getDb().prepare("SELECT COUNT(*) n FROM invoices").get()).toEqual({ n: 1 });
  expect(fs.readdirSync(dir)).toHaveLength(1);
});

test("unsupported type gets 400 and nothing is stored, even if another file in the batch is fine", async () => {
  expect((await post(1, pdf("a"), Buffer.from("hello"))).status).toBe(400);
  expect(getDb().prepare("SELECT COUNT(*) n FROM invoices").get()).toEqual({ n: 0 });
  expect(fs.readdirSync(dir)).toHaveLength(0);
});

test("no files gets 400", async () => {
  expect((await post(1)).status).toBe(400);
});

test("each role sees the right set", async () => {
  await post(1, pdf("1"));
  await post(2, pdf("2"));
  await post(3, pdf("3"));
  getDb().prepare("UPDATE invoices SET status='pending_approval' WHERE id=2").run();
  expect(await ids(1)).toEqual([1]);
  expect(await ids(2)).toEqual([2]);
  expect(await ids(4)).toEqual([2]);
  for (const u of [3, 5, 6, 7]) expect(await ids(u)).toEqual([1, 2, 3]);
});

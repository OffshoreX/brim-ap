import { csvCell } from "./csv";
import type { User } from "@/contracts";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { formatCents } from "./payments";
import { nameKey, norm, reconcile, type LineInput, type PayInput, type PayStatus, type Reconciled } from "./rules/reconcile";

// A payment that left the building: settled (EFT, card) or outstanding (cheque issued). Scheduled ones have not paid anything yet.
const RELEASED = "('settled','outstanding')";

export const CATEGORIES = ["matched", "payment_unmatched", "payment_ambiguous", "amount_diff", "duplicate", "bank_no_payment", "card_no_payment"] as const;
export type Category = (typeof CATEGORIES)[number];
export type ReportRow = {
  category: Category;
  paymentId: number | null;
  invoiceNumber: string | null;
  vendor: string | null;
  method: string | null;
  paymentCents: number | null;
  lineSource: "bank" | "card" | null;
  lineId: string | null;
  lineText: string | null;
  lineDate: string | null;
  lineCents: number | null;
  diffCents: number | null;
  note: string;
};
export type Report = { summary: Record<Category, number>; rows: ReportRow[] };

type PayRow = { id: number; invoice_number: string | null; vendor: string | null; method: PayInput["method"]; cents: number; paid: string; reference: string | null; stored: string | null };

function load() {
  const db = getDb();
  const pays = db
    .prepare(
      `SELECT p.id, i.invoice_number, v.name AS vendor, p.method, COALESCE(p.amount_cad_cents, p.amount_cents) AS cents,
              substr(COALESCE(p.paid_at, p.scheduled_date), 1, 10) AS paid, p.reference, p.reconciliation_status AS stored
       FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN vendors v ON v.id = p.vendor_id
       WHERE p.status IN ${RELEASED} ORDER BY p.id`
    )
    .all() as PayRow[];
  const bank = db
    .prepare("SELECT COALESCE(ext_id, CAST(id AS TEXT)) AS id, posted_date AS date, COALESCE(description,'') AS text, debit_cents AS cents FROM bank_statement WHERE debit_cents IS NOT NULL ORDER BY id")
    .all() as LineInput[];
  // card_no_payment only looks at AP virtual cards and vendor-looking merchants; the rest is staff spend, not our business here.
  const card = db
    .prepare("SELECT COALESCE(ext_id, CAST(id AS TEXT)) AS id, posted_date AS date, COALESCE(merchant_descriptor,'') AS text, COALESCE(amount_cad_cents, amount_cents) AS cents, source FROM card_transactions ORDER BY id")
    .all() as (LineInput & { source: string | null })[];
  const vendorKeys = (db.prepare("SELECT name FROM vendors").all() as { name: string }[]).map((v) => nameKey(v.name)).filter((k) => k.length >= 4);
  return { pays, bank, card, vendorKeys };
}

// Pure assembly of the report from the database rows, so it is the same whether the caller is a route, a script or a test.
export function buildReport(): { report: Report; results: Map<number, { status: PayStatus; lineId: string | null; reason: string | null }>; pays: PayRow[] } {
  const { pays, bank, card, vendorKeys } = load();
  const inputs: PayInput[] = pays.map((p) => ({ id: p.id, method: p.method, amountCents: p.cents, paidDate: p.paid, vendorName: p.vendor, reference: p.reference }));
  const run = reconcile(inputs, bank, card);
  const byId = new Map(pays.map((p) => [p.id, p]));
  const lines = { bank: new Map(bank.map((l) => [l.id, l])), card: new Map(card.map((l) => [l.id, l])) };
  const rows: ReportRow[] = [];
  const results = new Map<number, { status: PayStatus; lineId: string | null; reason: string | null }>();

  const add = (category: Category, source: "bank" | "card", paymentId: number | null, lineId: string | null, diffCents: number | null, note: string) => {
    const p = paymentId === null ? undefined : byId.get(paymentId);
    const l = lineId === null ? undefined : lines[source].get(lineId);
    rows.push({
      category, paymentId, invoiceNumber: p?.invoice_number ?? null, vendor: p?.vendor ?? null, method: p?.method ?? null, paymentCents: p?.cents ?? null,
      lineSource: l ? source : null, lineId, lineText: l?.text ?? null, lineDate: l?.date ?? null, lineCents: l?.cents ?? null, diffCents, note,
    });
  };

  const side = (source: "bank" | "card", r: Reconciled) => {
    for (const p of r.payments) {
      results.set(p.paymentId, { status: p.status, lineId: p.lineId, reason: p.reason });
      const category: Category = p.status === "matched" ? "matched" : p.status === "unmatched" ? "payment_unmatched" : p.status === "ambiguous" ? "payment_ambiguous" : "amount_diff";
      add(category, source, p.paymentId, p.lineId, p.diffCents, p.reason ?? "");
    }
    for (const d of r.duplicates) add("duplicate", source, d.paymentId, d.lineId, null, "a second line for a payment that already has one");
    for (const id of r.orphanLineIds) {
      const l = lines[source].get(id) as LineInput & { source?: string | null };
      const t = norm(l.text);
      const vendorLike = vendorKeys.some((k) => t.includes(k));
      // Bank fees and similar are not vendor payments; only vendor-looking debits are worth an alarm.
      if (source === "bank" && vendorLike) add("bank_no_payment", "bank", null, id, null, "bank debit to a known vendor with no payment on file");
      if (source === "card" && (vendorLike || l.source === "ap_virtual_card")) add("card_no_payment", "card", null, id, null, l.source === "ap_virtual_card" ? "AP virtual card charge with no payment on file" : "card charge to a known vendor with no payment on file");
    }
  };
  side("bank", run.bank);
  side("card", run.card);
  const summary = Object.fromEntries(CATEGORIES.map((c) => [c, rows.filter((r) => r.category === c).length])) as Record<Category, number>;
  return { report: { summary, rows }, results, pays };
}

export type ReportFilter = { category?: Category; method?: string };
export const isCategory = (v: string): v is Category => (CATEGORIES as readonly string[]).includes(v);

export function reconciliationReport(f: ReportFilter, page: { limit: number; offset: number } | null) {
  const { report } = buildReport();
  const rows = report.rows.filter((r) => (!f.category || r.category === f.category) && (!f.method || r.method === f.method));
  return { summary: report.summary, total: rows.length, rows: page ? rows.slice(page.offset, page.offset + page.limit) : rows };
}

const HEAD: (keyof ReportRow)[] = ["category", "paymentId", "invoiceNumber", "vendor", "method", "paymentCents", "lineSource", "lineId", "lineText", "lineDate", "lineCents", "diffCents", "note"];
const cell = (v: string | number | null) => csvCell(v); // shared formula-injection guard
// Money columns go out as decimals, the same way the EFT file does, so a spreadsheet reads them as money.
const MONEY = new Set<keyof ReportRow>(["paymentCents", "lineCents", "diffCents"]);

export function reconciliationCsv(f: ReportFilter): string {
  const { rows } = reconciliationReport(f, null);
  const head = HEAD.map((k) => (MONEY.has(k) ? String(k).replace("Cents", "") : k)).join(",");
  const body = rows.map((r) => HEAD.map((k) => cell(MONEY.has(k) && r[k] !== null ? formatCents(r[k] as number) : (r[k] as string | number | null))).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}

// Saves each released payment's verdict. Only a payment whose status changed is written, and each write has its audit row.
export function applyReconciliation(user: User | null): { changed: number; summary: Record<Category, number> } {
  const db = getDb();
  return db.transaction(() => {
    const { report, results, pays } = buildReport();
    let changed = 0;
    const set = db.prepare("UPDATE payments SET reconciliation_status = ? WHERE id = ?");
    for (const p of pays) {
      const r = results.get(p.id);
      if (!r || r.status === p.stored) continue;
      set.run(r.status, p.id);
      writeAudit({ actorId: user?.id ?? null, action: "payment.reconcile", entity: "payment", entityId: p.id, before: { reconciliationStatus: p.stored }, after: { reconciliationStatus: r.status, lineId: r.lineId, reason: r.reason } });
      changed++;
    }
    return { changed, summary: report.summary };
  })();
}

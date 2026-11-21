-- Processing log (T71): what the pipeline did for an invoice, step by step, and how long each step took.
-- Append only like audit_log. It is derived work: it never feeds a decision, and a failed write never fails the invoice.
CREATE TABLE IF NOT EXISTS process_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','flagged','failed','skipped')),
  detail TEXT NOT NULL, -- one plain-English sentence; never model text or a secret
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_process_log_invoice ON process_log(invoice_id, id);

CREATE TRIGGER IF NOT EXISTS process_log_no_update BEFORE UPDATE ON process_log
BEGIN SELECT RAISE(ABORT, 'process_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS process_log_no_delete BEFORE DELETE ON process_log
BEGIN SELECT RAISE(ABORT, 'process_log is append-only'); END;

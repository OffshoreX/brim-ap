-- One row per email we have processed (also makes import idempotent), and which invoices each email created.
CREATE TABLE IF NOT EXISTS inbox_mail (
  email_id TEXT PRIMARY KEY,
  from_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  received_at TEXT,
  class TEXT NOT NULL CHECK (class IN ('invoice','credit_note','statement','payment_inquiry','marketing','invoice_missing_attachment')),
  attachments TEXT NOT NULL DEFAULT '[]',
  flags TEXT NOT NULL DEFAULT '[]'
);
-- Kept out of invoices so older database files need no ALTER.
CREATE TABLE IF NOT EXISTS invoice_email (
  invoice_id INTEGER PRIMARY KEY REFERENCES invoices(id),
  email_id TEXT NOT NULL REFERENCES inbox_mail(email_id),
  from_address TEXT NOT NULL
);

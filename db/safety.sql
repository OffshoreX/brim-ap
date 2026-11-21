-- Double-action safety (T57). Every statement is idempotent, so this runs on an empty database and on a populated one.
-- The code already re-reads status inside an IMMEDIATE transaction; these indexes are the database refusing a
-- duplicate even if some code path ever forgot to check.

-- One payment per invoice. Only rows the app created (ext_id NULL): the dataset's own payments.csv holds three
-- historical double payments that reconciliation reports, so those rows stay as they are.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_per_invoice ON payments(invoice_id) WHERE ext_id IS NULL;

-- One signed decision per step of an invoice's chain (approval_steps already has UNIQUE (invoice_id, step_no)).
CREATE UNIQUE INDEX IF NOT EXISTS uq_approvals_one_per_step ON approvals(invoice_id, step_no) WHERE step_no IS NOT NULL;

-- One open bank-change request per vendor, so verify can never pick between two.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_change_one_pending ON vendor_bank_changes(vendor_id) WHERE status = 'pending';

-- Idempotency-Key header: the first successful response for (user, action, key) is kept and replayed.
-- request_hash is a hash of the request, so reusing a key for a different request is refused instead of replayed.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, scope, key)
);

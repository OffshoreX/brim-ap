-- Money columns elsewhere are integer cents; approval_limit_cents follows that rule.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee','ap_clerk','approver','finance_manager','controller_admin','auditor')),
  manager_id INTEGER REFERENCES users(id),
  approval_limit_cents INTEGER NOT NULL DEFAULT 0,
  province TEXT
);

-- before/after hold JSON text so any entity can be logged by one table.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before TEXT,
  after TEXT
);

-- The audit trail is append-only: edits and deletes are blocked in the database itself.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

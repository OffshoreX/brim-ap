-- Money columns elsewhere are integer cents; approval_limit_cents follows that rule.
-- ext_id keeps the dataset's original id (U001); our id is its number part.
-- on_leave is now status = 'on_leave'; delegate_id is now delegate_user_id.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  title TEXT,
  department_id INTEGER REFERENCES departments(id),
  role TEXT NOT NULL CHECK (role IN ('employee','ap_clerk','approver','finance_manager','controller_admin','auditor')),
  manager_id INTEGER REFERENCES users(id),
  approval_limit_cents INTEGER NOT NULL DEFAULT 0,
  province TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','terminated')),
  status_since TEXT,
  delegate_user_id INTEGER REFERENCES users(id),
  hire_date TEXT,
  password_hash TEXT -- scrypt hash from src/server/password.ts, never the password
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
  after TEXT,
  prev_hash TEXT,  -- hash chain: row_hash of the previous row ('' for the first)
  row_hash TEXT    -- sha256 of prev_hash + this row's fields, computed only in src/server/audit.ts
);

-- The audit trail is append-only: edits and deletes are blocked in the database itself.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

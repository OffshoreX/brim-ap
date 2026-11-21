-- Approval routing rules. Amounts are integer cents; range is [min_cents, max_cents).
-- department NULL means the rule applies to any department.
CREATE TABLE IF NOT EXISTS approval_rules (
  id INTEGER PRIMARY KEY,
  department TEXT,
  min_cents INTEGER NOT NULL CHECK (min_cents >= 0),
  max_cents INTEGER NOT NULL,
  approver_role TEXT NOT NULL CHECK (approver_role IN ('employee','ap_clerk','approver','finance_manager','controller_admin','auditor')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  CHECK (min_cents < max_cents)
);

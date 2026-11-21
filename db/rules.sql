-- Chain thresholds. An invoice goes up a level when its CAD total is OVER over_cents (exactly at it stays below);
-- extra_role is the step that level adds. Seeded from the approval_policies rows by seedApprovalRules().
CREATE TABLE IF NOT EXISTS approval_rules (
  id INTEGER PRIMARY KEY,
  policy_id TEXT UNIQUE,
  over_cents INTEGER NOT NULL CHECK (over_cents >= 0),
  extra_role TEXT NOT NULL UNIQUE CHECK (extra_role IN ('finance_manager','controller_admin','cfo'))
);

-- The chain stored for one invoice, built once when it is processed. A decision is accepted only from the
-- user of the lowest step still 'pending'. approvals (domain.sql) keeps the signed record of each decision.
CREATE TABLE IF NOT EXISTS approval_steps (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  step_no INTEGER NOT NULL,
  role TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  delegated_from_id INTEGER REFERENCES users(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','skipped')),
  UNIQUE (invoice_id, step_no)
);

-- Domain tables. Money is integer cents plus a currency code, never floats.
-- Every table with an id in the dataset CSV has ext_id (the original id, e.g. V015); our id is its number part.
-- FX rates are stored times 10000 (1.3709 -> 13709), the same convention as rules/fx.ts.
-- Dataset column -> table column renames are listed in src/server/schema.test.ts.
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  name TEXT NOT NULL,
  cost_centre TEXT,
  annual_budget_cents INTEGER,
  manager_user_id INTEGER REFERENCES users(id)
);

-- currency is not in the dataset; it defaults to CAD.
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  default_gl_account TEXT,
  address TEXT,
  province_or_state TEXT,
  country TEXT,
  gst_hst_number TEXT,
  qst_number TEXT,
  payment_terms_days INTEGER,
  early_pay_discount TEXT,
  preferred_payment_method TEXT CHECK (preferred_payment_method IN ('EFT','CHEQUE','CARD')),
  accepts_card_payment INTEGER CHECK (accepts_card_payment IN (0,1)),
  bank_institution TEXT,
  bank_transit TEXT,
  bank_account TEXT,
  bank_details_updated_at TEXT,
  ap_contact_email TEXT,
  requires_po INTEGER CHECK (requires_po IN (0,1)),
  status TEXT,
  onboarded_at TEXT,
  currency TEXT NOT NULL DEFAULT 'CAD' CHECK (currency IN ('CAD','USD'))
);

-- Every bank change is a new row, so a changed account can be spotted and traced.
CREATE TABLE IF NOT EXISTS vendor_bank_changes (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  changed_at TEXT NOT NULL,
  changed_by_user_id INTEGER REFERENCES users(id),
  request_channel TEXT,
  verified_by_callback INTEGER CHECK (verified_by_callback IN (0,1)),
  old_account_last4 TEXT,
  new_account_last4 TEXT,
  -- Workflow (T32): a request stays 'pending' with the full new details until a different user verifies it.
  -- Dataset rows are history that already took effect, so they default to 'applied'.
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('pending','applied','rejected')),
  new_bank_institution TEXT,
  new_bank_transit TEXT,
  new_bank_account TEXT,
  verified_by_user_id INTEGER REFERENCES users(id),
  verified_at TEXT
);

-- Which fee columns are filled depends on billing_type (fixed fee, rate card, blanket, retainer).
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  description TEXT,
  billing_type TEXT NOT NULL CHECK (billing_type IN ('fixed_monthly','rate_card','blanket','retainer')),
  monthly_fee_cents INTEGER,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  hourly_rate_cap_cents INTEGER,
  fuel_surcharge_cap_pct REAL, -- a percentage, not money
  not_to_exceed_monthly_cents INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 0 CHECK (auto_renew IN (0,1)),
  status TEXT
);

-- po_number holds the dataset's po_id (PO-2026-0001), so there is no separate ext_id.
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  department_id INTEGER REFERENCES departments(id),
  requester_user_id INTEGER REFERENCES users(id),
  issue_date TEXT,
  description TEXT,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  status TEXT,
  approved_by INTEGER REFERENCES users(id)
);

-- code is the dataset's account_number.
CREATE TABLE IF NOT EXISTS gl_accounts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  account_type TEXT,
  notes TEXT
);

-- rate in basis points (500 = 5%). REAL because Quebec QST is 997.5 bps; every rate is a whole multiple of 0.5.
CREATE TABLE IF NOT EXISTS tax_codes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  province TEXT,
  rate_bps REAL NOT NULL,
  applies_to TEXT,
  recoverable TEXT CHECK (recoverable IN ('yes','no','n/a')),
  gl_account TEXT
);

-- flags is JSON text (list of reasons) so new checks need no schema change.
-- extraction_json keeps the raw extractor output so a review can see what the model read.
-- invoice_number is the vendor's own number (dataset vendor_invoice_number).
-- department is a free-text name; department_id is the real link (the approval chain uses the requester's department).
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','needs_review','pending_approval','approved','scheduled','rejected','paid')),
  vendor_id INTEGER REFERENCES vendors(id),
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  received_date TEXT,
  due_date TEXT,
  subtotal_cents INTEGER,
  gst_hst_cents INTEGER,
  pst_qst_cents INTEGER,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  fx_rate_to_cad_bps INTEGER,
  total_cad_cents INTEGER,
  requester_id INTEGER REFERENCES users(id),
  department TEXT,
  department_id INTEGER REFERENCES departments(id),
  po_id INTEGER REFERENCES purchase_orders(id),
  contract_id INTEGER REFERENCES contracts(id),
  ship_to_province TEXT,
  -- Where ship_to_province came from: invoice (printed), po_requester, requester, vendor or clerk (guessed, see rules/placeOfSupply.ts).
  ship_to_source TEXT CHECK (ship_to_source IN ('invoice','po_requester','requester','vendor','clerk')),
  flags TEXT NOT NULL DEFAULT '[]',
  source_file TEXT,
  extraction_json TEXT,
  extracted_at TEXT
);

-- gl_account_id points at gl_accounts (dataset gl_account is the account number); gst_hst_code and
-- pst_qst_code hold tax_codes.code. line_no and line_type are nullable so extracted lines can be saved first.
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  line_no INTEGER,
  line_type TEXT CHECK (line_type IN ('goods','services')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  gl_account_id INTEGER REFERENCES gl_accounts(id),
  department_id INTEGER REFERENCES departments(id),
  gst_hst_code TEXT,
  pst_qst_code TEXT,
  tax_code_id INTEGER REFERENCES tax_codes(id),
  tax_cents INTEGER NOT NULL DEFAULT 0,
  -- Coding (T50): where the account came from, why, and whether a human still has to set it.
  coding_source TEXT,
  coding_reason TEXT,
  coding_needed INTEGER NOT NULL DEFAULT 0 CHECK (coding_needed IN (0,1)),
  UNIQUE (invoice_id, line_no)
);

-- approver_role is free text ('dept_manager' is a step role, not one of our user roles).
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  step_no INTEGER,
  approver_id INTEGER NOT NULL REFERENCES users(id),
  approver_role TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  comment TEXT,
  delegated INTEGER NOT NULL DEFAULT 0 CHECK (delegated IN (0,1)),
  delegated_from_id INTEGER REFERENCES users(id)
);

-- Defaults (EFT, settled, paid_at = now) keep the current instant simulated release working;
-- a scheduled or outstanding payment is stored with paid_at NULL.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  vendor_id INTEGER REFERENCES vendors(id),
  method TEXT NOT NULL DEFAULT 'EFT' CHECK (method IN ('EFT','CHEQUE','CARD')),
  scheduled_date TEXT,
  paid_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  fx_rate_to_cad_bps INTEGER,
  amount_cad_cents INTEGER,
  discount_taken_cents INTEGER NOT NULL DEFAULT 0,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'settled',
  prepared_by INTEGER REFERENCES users(id),
  released_by INTEGER REFERENCES users(id),
  -- Written only by applyReconciliation (audited); NULL = never reconciled or not paid yet.
  reconciliation_status TEXT CHECK (reconciliation_status IN ('matched','unmatched','ambiguous','amount_diff'))
);

CREATE TABLE IF NOT EXISTS card_transactions (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  card_id TEXT,
  cardholder_user_id INTEGER REFERENCES users(id),
  posted_date TEXT NOT NULL,
  merchant_descriptor TEXT,
  mcc TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  amount_cad_cents INTEGER,
  source TEXT,
  receipt_attached INTEGER CHECK (receipt_attached IN (0,1)),
  memo TEXT
);

-- debit and credit are mutually exclusive in the data, so one of them is NULL.
CREATE TABLE IF NOT EXISTS bank_statement (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  posted_date TEXT NOT NULL,
  description TEXT,
  debit_cents INTEGER,
  credit_cents INTEGER
);

CREATE TABLE IF NOT EXISTS fx_rates (
  date TEXT PRIMARY KEY,
  usd_to_cad_bps INTEGER NOT NULL
);

-- Reference rows describing the approval and payment policy; read by people, not used to route.
CREATE TABLE IF NOT EXISTS approval_policies (
  id INTEGER PRIMARY KEY,
  ext_id TEXT UNIQUE,
  rule_type TEXT NOT NULL,
  condition TEXT NOT NULL,
  required TEXT,
  notes TEXT
);

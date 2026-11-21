-- Domain tables. Money is integer cents plus a currency code, never floats.
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tax_id TEXT,
  province TEXT,
  currency TEXT NOT NULL DEFAULT 'CAD' CHECK (currency IN ('CAD','USD')),
  bank_details TEXT
);

-- Every bank change is a new row, so a changed account can be spotted and traced.
CREATE TABLE IF NOT EXISTS vendor_bank_history (
  id INTEGER PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  bank_details TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  changed_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  unit_price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD'))
);

CREATE TABLE IF NOT EXISTS gl_accounts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- rate in basis points (500 = 5%) so tax math stays integer.
CREATE TABLE IF NOT EXISTS tax_codes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  province TEXT,
  rate_bps INTEGER NOT NULL
);

-- flags is JSON text (list of reasons) so new checks need no schema change.
-- extraction_json keeps the raw extractor output so a review can see what the model read.
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','needs_review','pending_approval','approved','rejected','paid')),
  vendor_id INTEGER REFERENCES vendors(id),
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  requester_id INTEGER REFERENCES users(id),
  po_id INTEGER REFERENCES purchase_orders(id),
  flags TEXT NOT NULL DEFAULT '[]',
  source_file TEXT,
  extraction_json TEXT,
  extracted_at TEXT
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  gl_account_id INTEGER REFERENCES gl_accounts(id),
  tax_code_id INTEGER REFERENCES tax_codes(id),
  tax_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  approver_id INTEGER NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  comment TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD','USD')),
  released_by INTEGER REFERENCES users(id),
  paid_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

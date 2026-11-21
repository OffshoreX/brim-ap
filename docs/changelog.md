# Changelog (plain English, for the Q&A)

One line per merged PR, newest last. Judge question in brackets.

- PR 2, skeleton: Next.js app, SQLite, login dropdown, signed cookie, `requireRole`, audit log. [roles]
- PR 4, hardening: login returns 400 on bad input, async-safe handler, audit log cannot be edited or deleted. [roles, audit]
- PR 12, validation rules: arithmetic check and duplicate detection (exact and near) as plain functions. [duplicates and mismatches]
- PR 13, approval routing: picks the approver by amount and department; self-request goes to the manager; leave goes to the delegate. [roles]
- PR 14, payment release: only finance manager or above, within their limit; approver blocked. [roles]
- PR 15, bank-change check: flags details that differ, were never seen or changed in the last 30 days. [duplicates and mismatches]
- PR 16, coding suggestions: most frequent account and tax code for a vendor, with the reason; none if fewer than 3 past invoices. [data model]
- PR 7, domain schema: vendors, bank history, contracts, POs, invoices, lines, approvals, payments; status flow allows only listed moves and writes an audit row. [data model]

## Known gaps
- invoice_lines has no per-line tax amount column yet (the brief wants each tax amount captured).
- No place yet to keep the raw extraction result or source file name per invoice.
- The database file is built with CREATE TABLE IF NOT EXISTS, so adding columns later needs a rebuild (delete data/app.db and re-import). Treat the DB as disposable.

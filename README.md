# Harborline AP

Accounts payable automation for Harborline Logistics on the Brim business card platform. An invoice goes in, is read, coded, checked, approved, paid (simulated) and audited, with every step explained in plain words and recorded.

Built for McGill CodeJam 16, Brim track.

## Run it

Needs Node 24.

1. `npm install`
2. Create `.env.local` in the repo root with two lines:
   - `SESSION_SECRET=<any long random string>` (required, sign-in fails without it)
   - `ANTHROPIC_API_KEY=<key>` (only needed to read invoices that are not already in the extraction cache)
3. `node scripts/reset-db.mjs` builds the database from the sample dataset in `brim_ap_dataset/`.
4. `npm run demo` starts the API and the web app together. Open the address on the `[web]` line (not port 3000).

Sign in with any user email from `brim_ap_dataset/data/users.csv` and the password `harborline-demo` (override with `DEMO_PASSWORD`). One browser holds one login, so use separate browsers or profiles for different roles.

| Role | Example user |
|---|---|
| AP clerk | jordan.okafor |
| Approver | dev.malhotra |
| Finance manager | elise.tremblay |
| Controller | priya.raman, marcus.webb |
| Auditor | hannah.lindqvist |
| Employee | aiden.grant |

(Emails are `first.last@harborline-logistics.example`.)

## What it does

- **Intake and extraction:** upload PDFs or images, or import the AP inbox. A model reads each invoice (English and French); its answer is checked against a schema, and anything invalid goes to needs review.
- **Checks, all plain tested functions (no model):** vendor status, duplicates (including card payments), arithmetic, tax by province, contract and PO matching, bank-change risk, split invoices, credit notes, budget and anomaly flags.
- **Coding:** a GL account per line learned from history, with the reason shown.
- **Approval:** routing by amount, vendor status and policy, editable rules, delegation, no self-approval. The approver of an invoice cannot release its payment.
- **Payments:** simulated EFT, cheque and card with release limits by role, early-payment discounts, bank reconciliation.
- **Audit:** every state change is an append-only, hash-chained row; the chain can be verified from the Audit page.
- **Vendors:** onboarding as pending review, holds, and bank changes only through a verified callback.
- **Also:** process log per invoice, journal export, search and filters, spend reports.

## How roles are enforced

On the server, in one place: `src/server/authz.ts`. The web app hides buttons for looks only. Role and status are read from the database on every request.

## Layout

- `src/server/`, `src/app/api/`, `db/`: API, rules and SQLite schema (plain SQL).
- `src/extract/`: the only place a model reads invoices.
- `web/`: the user interface (Vite, TanStack Router, Tailwind). Talks to the server only through `/api`.
- `src/app/` (pages): the earlier interface, superseded by `web/`.
- `scripts/`: database, import, batch and demo tools.
- `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `docs/`: rules, product brief, design system, decisions.

## Tests

`npm test` runs the server and rule tests. `cd web && npm run build` checks the web app.

All data is synthetic. No real payments move.

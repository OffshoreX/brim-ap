# Decisions (Brim track, solo)

Source of truth for scope. Change a line only with the lead's yes.

## Stack
- TypeScript, Next.js (App Router), SQLite via better-sqlite3, plain SQL in db/schema.sql. No ORM. Supabase rejected (hosted dependency, no benefit here).
- Backend first as plain JSON endpoints, documented in src/contracts.ts. UI is bare until the last pass. Any UI tool (Lovable or hand-built) may only call those endpoints. No business logic or role checks in UI code.
- vitest for tests.

## Build order
1. Thin path through the whole pipeline: intake, extraction, validation, approval, payment, audit log.
2. Then deepen duplicates, bank-change checks and tax checks.
3. Vendor management and delegation come last. Bonus features are untouched until the demo path runs end to end.

## Roles and login
- Login is a dropdown of the sample users. A signed HTTP-only cookie holds the user id. The role is always read from the database.
- The server checks the role on every route through requireRole in src/server/authz.ts.
- Real login only if time allows.

## Extraction
- Claude vision returns structured JSON, validated against a schema. Failures become "needs review". Results cached per file.
- Anthropic API key in .env.local, with a hard spending cap.
- Upload page accepts any new PDFs and processes them in one click. Nothing depends on sample file names.

## Rules (plain code, unit tested, no LLM)
- Duplicate detection, matching, tax checks, approval routing and payment limits are plain functions.
- Approval rules live in a database table (amount range and department decide the approver role). The controller edits them in one form.
- Coding suggestions come from vendor history first, shown with the reason ("used 14 of 15 times"). The LLM is used only for vendors with no history.
- Payments are simulated: a payment record plus a downloadable EFT file. Only a finance manager or above can release, within their limit. An approver cannot release.
- One Exceptions page lists every flagged invoice with the reason.

## Demo (about 2 minutes)
1. A clean invoice goes all the way to paid.
2. An invoice with changed bank details is caught and held.
3. A requester tries to approve their own invoice and it escalates to their manager.

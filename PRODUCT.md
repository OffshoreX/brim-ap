# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Six roles of equal standing, each with a role-specific home: AP clerk, requester (employee), approver, finance manager, controller, auditor (read-only). No single role is primary. Staff at Harborline Logistics, a customer on the Brim business card platform. Secondary audience: McGill CodeJam 16 judges watching a roughly 2-minute demo and probing in live Q&A.

## Product Purpose

Accounts payable automation: invoice in, extracted, coded, validated, approved, paid (simulated), audited. Success is that a clean invoice reaches paid, a bad one is caught and held with a stated reason, and every state change is traceable.

## Positioning

Every flag, block, route and status comes from plain, unit-tested code (no LLM in duplicate detection, matching, tax checks, approval routing or payment limits), shows its reason in plain text, and is audited. The LLM only reads invoices; its output is schema-validated, and failures become "needs review" rather than a silent guess.

## Operating Context

Demo path: (1) a clean invoice goes all the way to paid; (2) an invoice with changed bank details is caught and held; (3) a requester tries to approve their own invoice and it escalates to their manager. A hidden batch of invoices will be used, so nothing may depend on sample names. Presented on laptop or projector.

## Capabilities and Constraints

- Stack: TypeScript, Next.js App Router, SQLite, plain SQL. Roles enforced server-side in src/server/authz.ts; the UI only hides things for looks.
- Money is integer cents plus currency code.
- Styling: plain CSS in src/app/ui.css only, no new libraries or dependencies.
- Motion: only a one-time load animation (e.g. chart bars growing), under 300ms, disabled under prefers-reduced-motion.
- Reasons for every flag, block and status appear as plain text next to it, never hidden in a tooltip.
- Ownership: the ui agent owns src/app/** (except api) and src/components/**; business logic and role checks never live in UI code.
- Judging weights: required features 40%, bonus 15%, clean UI 20%, technical depth 25%.

## Brand Commitments

Keep the "Harborline AP" header brand. "brim-ap" is a placeholder repo name, to be renamed later.

## Evidence on Hand

Synthetic Brim dataset in brim_ap_dataset/ (committed to the private repo) and sample incoming invoice PDFs. No real customer testimonials or metrics exist; do not fabricate any. No mock data on the demo path.

## Product Principles

1. Show the reason, in plain text, next to every flag, block and status.
2. The server decides; the UI reflects. Never imply a permission the server will refuse.
3. Never guess silently: uncertain extraction is visibly "needs review".
4. Demo path first; every screen must be explainable by its builder to a judge.
5. Real data only on the demo path.

## Accessibility & Inclusion

WCAG 2.1 AA required. Desktop-first; mobile must not break. Respect prefers-reduced-motion.

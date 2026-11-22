# Harborline AP — frontend only

Build the full accounts-payable UI described in the brief, talking only to the existing API. No backend, database or Cloud.

## Two necessary adjustments

- **Router**: this project runs on TanStack Start / TanStack Router (fixed, React Router can't be installed). Same pages and URLs, one file per page under `src/routes`, page bodies in `src/pages`. TanStack Query stays.
- **Preview**: the hosted preview can't reach `localhost:3000`. The `/api` proxy is added to `vite.config.ts` for local runs; in the Lovable preview I'll turn on sample data (`VITE_USE_MOCKS=true` via `.env`) so screens can be reviewed, with the yellow "Sample preview data" banner. Set it to false or remove it when running against the real backend.

## Design

Off-white page, white rounded cards, dark navy sidebar with icons, accent #1d4ed8, big titles, tabular right-aligned money (Intl, integer cents, "1,234.56 CAD"). Status pills = colour + icon + word. Flags show reasons as text. 36px controls, visible focus ring, AA contrast. One bar-grow animation (250ms), off with reduced motion. Tokens in `src/styles.css`. Font: IBM Plex Sans + Plex Mono for numbers. No photos, card widget, promos, fake search, gradients. Initials avatar.

## Architecture

- `src/lib/api.ts` — every fetch (relative `/api`, `credentials: "include"`), error parsing `{error}`, X-Total-Count paging, Idempotency-Key on approve/reject/prepare/release/bank-change, 401 → /login, 403 → "Your role can't see this", 409/429 messages, logout 404 tolerated.
- `src/lib/types.ts` — all response types, header comment "Verify against the backend's src/contracts.ts".
- `src/lib/mock.ts` — sample data, used only when mocks flag is on.
- `src/lib/roles.ts` — role labels + which actions/sidebar items each role sees (comment: server is the real enforcer).
- `src/hooks/*` — one query/mutation hook per endpoint, each commented with its endpoint.
- `src/components/*` — StatusPill, Money, StatCard, BarChart, DataTable, Pager ("Showing 1–50 of 426"), FlagBox, ApprovalStepper, ProcessSteps, AuditTrail, ConfirmInline, States (loading/empty/error/forbidden), MockBanner, AppSidebar, UserMenu.

## Pages

Login, Dashboard, Invoices (status tabs + paging), Invoice detail (sticky header, flags, GL coding edit, approval chain, process steps, trail, inline release confirm, "Resolve in Exceptions"), Upload (drag-drop, progress, live process-log polling 1s), Approvals inbox, Exceptions, Payments (ready/prepare, release, EFT/cheque downloads), Vendors list + detail (bank change + verify, confirmed), Reports, Reconciliation, Audit log (Verify chain), Activity log, Admin approval rules. Each has loading, empty (with next-step link) and error states; sidebar filtered by role; each route has its own title/description.

## Not verifiable here

Real backend calls, cookies and role enforcement can only be tested against your running server.

### Approved, with three changes:

1. TanStack Start renders on the server, where relative "/api" fetches fail. Fetch all data client-side only: TanStack Query inside components, no server functions, no route loaders that call the API on the server. Disable SSR for app routes if needed (ssr: false), and don't create any server functions or server routes.

2. Fonts: no Google Fonts link (the demo runs on venue wifi). Either self-host IBM Plex Sans/Mono files inside the project or use the system font stack with font-variant-numeric: tabular-nums.

3. Mocks: put VITE_USE_MOCKS=true only in .env.development (or the preview env), not in a file that would also apply to a production build. The banner must say "Sample preview data, not real" and be impossible to miss.
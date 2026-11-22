# AGENTS.md

Read this first. Every agent in this repo follows it. The human is Ulysse (the lead). He must be able to explain every line that ships.

## 0. Project

- Name: Harborline AP (repo: brim-ap)
- Pitch: accounts payable automation for Harborline Logistics on the Brim business card platform. Invoice in, extracted, coded, validated, approved, paid (simulated), audited.
- Event: McGill CodeJam 16, Brim track. Code started after 7:00 PM Friday Nov 20 2026. Hard freeze: 12:00 PM Sunday Nov 22. Final push by 11:30 AM.
- Judging: required features 40%, bonus features 15% (only scored if required ones work), clean UI 20%, technical depth 25% (live Q&A).
- Demo path: upload an invoice, watch the process log, see flags with reasons, approve through the chain, schedule and release payment by a different person, then verify the audit chain.
- Stack: TypeScript, Next.js API and SQLite on the server. The user interface is moving to web/ (Vite, TanStack Router, Tailwind, shadcn/ui, first drafted in Lovable). web/ is its own app with its own package.json; it talks to the server only through /api (dev proxy to localhost:3000). The old pages in src/app stay until web/ replaces them.
- Contracts file: src/contracts.ts (shared types and API shapes). Created in ticket 1.

## 1. One owner per area

| Agent | Owns | Never touches |
|---|---|---|
| ui | web/**, src/app/** except src/app/api/**, src/components/**, public/** | src/server/**, src/extract/**, src/app/api/**, db/**, scripts/** |
| engine | src/server/**, src/app/api/**, db/**, scripts/** | web/**, rest of src/app/**, src/components/**, src/extract/** |
| extract | src/extract/** | everything else |
| lead (Ulysse) | AGENTS.md, CLAUDE.md, README.md, docs/**, src/contracts.ts, package.json, config files | nothing is off limits |

- API route files under src/app/api/** are engine's and stay thin: they parse the request, call requireRole, then call a function in src/server/**.
- Need a change outside your folders? Do not make it. Put the request in your PR description and stop.
- src/contracts.ts changes only through the lead. Propose the exact diff in the PR description.
- Adding a dependency needs the lead's yes first.

## 2. Crew rules

- At most 2 crewmates at once, one ticket each, until the lead says the walking skeleton is merged. After that the lead may allow 3.
- extract talks to the rest of the app only through the types in src/contracts.ts. engine never imports from src/extract/ internals.
- Work only from a GitHub issue that has an acceptance check. No ticket, no work.
- One branch per ticket. Fetch and rebase on main before every push.
- One coherent slice per PR, up to about 800 lines. Bigger than that, split it and say so.
- PR description ends with `Closes #N`.
- Agents never merge. The lead reviews and merges.

## 3. Code rules (these are what the judges will probe)

- Roles are enforced on the server, in one place: src/server/authz.ts. The UI may hide buttons for looks. The server decides.
- Business rules are plain functions with unit tests. No LLM inside duplicate detection, matching, tax checks, approval routing or payment limits.
- The LLM is used only in src/extract/ (reading invoices) and for coding suggestions. Its output is validated against a schema. If validation fails, mark the invoice "needs review". Never guess silently.
- No hardcoding of sample invoice numbers, vendor names or amounts. A hidden batch will be used.
- Money is stored as integer cents with a currency code. Never floats.
- Every state change writes an audit log row: who, what, when, before and after.
- Keep files short and boring. Add a one-line comment on why for anything non-obvious.

## 4. Explainability (non negotiable)

Every PR description has two parts:
1. Plain English: what changed and why, in 3 sentences.
2. Judge question: which of these it helps answer. How roles are enforced. How duplicates and mismatches are detected. How extraction handles bad inputs. Why the data is modelled this way. What breaks at 100x volume.

## 5. Secrets and checks

- Keys live in .env.local (gitignored). Model API calls come from server routes only. Never print a key.
- The synthetic Brim dataset lives in brim_ap_dataset/ and is committed to this private repo so every agent worktree can read it. Never read it from outside the repo. If the repo must become public, remove the dataset first.
- Before opening a PR, run the lint, test and build scripts that exist, and state in the PR which ones you ran and the result.

## 6. Do not

- Edit outside your owned folders.
- Fake a feature on the demo path with mock data.
- Leave a TODO that makes something look finished when it is not.
- Merge, force push, or rewrite history.

## 7. The web/ app (UI source of truth)

- web/ replaces the old UI. After the import, edit web/ here. Do not sync back to the Lovable project.
- All network calls live in web/src/lib/api.ts, all response types in web/src/lib/types.ts. Types must match what the server really returns (check by calling the endpoint, not by guessing). If the server shape is awkward, adapt it in api.ts; do not change server files from a ui ticket.
- Fetch on the client only (TanStack Query in components). No server functions or server-side data loading.
- Sample data (VITE_USE_MOCKS) is for design preview only and must never be on in a demo or a PR screenshot of real behaviour. Mock data must be shaped exactly like the real API.
- The plain-CSS-only and no-new-library rules apply to src/app. web/ may use its existing stack; any new dependency still needs the lead's yes.
- Run: cd web && npm install && npm run dev (backend on port 3000 first). Before a PR touching web/: cd web && npm run build and npm test, and say so in the PR.

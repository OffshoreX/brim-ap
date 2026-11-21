# AGENTS.md

Read this first. Every agent in this repo follows it. The human is Ulysse (the lead). He must be able to explain every line that ships.

## 0. Project

- Name: brim-ap (placeholder, rename later)
- Pitch: accounts payable automation for Harborline Logistics on the Brim business card platform. Invoice in, extracted, coded, validated, approved, paid (simulated), audited.
- Event: McGill CodeJam 16, Brim track. Code started after 7:00 PM Friday Nov 20 2026. Hard freeze: 12:00 PM Sunday Nov 22. Final push by 11:30 AM.
- Judging: required features 40%, bonus features 15% (only scored if required ones work), clean UI 20%, technical depth 25% (live Q&A).
- Demo path: TBD after the scope grill. Every ticket serves this path first.
- Stack: provisional. TypeScript, Next.js, SQLite. Confirmed in docs/decisions.md after the grill.
- Contracts file: src/contracts.ts (shared types and API shapes). Created in ticket 1.

## 1. One owner per area

| Agent | Owns | Never touches |
|---|---|---|
| ui | src/app/**, src/components/**, public/** | src/server/**, src/extract/**, db/**, scripts/** |
| engine | src/server/**, db/**, scripts/** | src/app/**, src/components/**, src/extract/** |
| extract | src/extract/** | everything else |
| lead (Ulysse) | AGENTS.md, CLAUDE.md, README.md, docs/**, src/contracts.ts, package.json, config files | nothing is off limits |

- Need a change outside your folders? Do not make it. Put the request in your PR description and stop.
- src/contracts.ts changes only through the lead. Propose the exact diff in the PR description.
- Adding a dependency needs the lead's yes first.

## 2. Crew rules

- At most 2 crewmates at once, one ticket each, until the lead says the walking skeleton is merged. After that the lead may allow 3.
- extract talks to the rest of the app only through the types in src/contracts.ts. engine never imports from src/extract/ internals.
- Work only from a GitHub issue that has an acceptance check. No ticket, no work.
- One branch per ticket. Fetch and rebase on main before every push.
- Small PRs, under about 300 lines. If it is bigger, split it and say so.
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
- The dataset lives in data/raw/ (gitignored) until we know whether the repo must be public.
- Before opening a PR, run the lint, test and build scripts that exist, and state in the PR which ones you ran and the result.

## 6. Do not

- Edit outside your owned folders.
- Fake a feature on the demo path with mock data.
- Leave a TODO that makes something look finished when it is not.
- Merge, force push, or rewrite history.

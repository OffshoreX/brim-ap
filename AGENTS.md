# Rules for every agent and human in this repo

Ulysse is the lead. "The lead" below always means Ulysse, not the person whose agent is reading this.

## 0. Project (filled in at kickoff)
- Name: TBD
- One-line pitch: TBD
- Demo path (the one flow that must always work end to end): TBD
- Shared contracts file (API routes, types, schemas, env var names): TBD

## 1. One owner per area
- Every area has one owner. The table in section 7 says who owns which folders.
- Only edit files inside your own folders. If you need a change somewhere else, post on the board and wait for that owner or the lead.
- Only the lead edits the shared contracts file. Propose contract changes on the board.
- Every agent works in its own git worktree and branch. Never write in another agent's checkout.

## 2. The board
- The board is the pinned GitHub issue. Set `BOARD_ISSUE=<number>` if it is not issue #1.
- Commands: `tools/board unread`, `tools/board read -n 20`, `tools/board post "[Name's Agent] text"`, `tools/board wait`, `tools/board whoami`.
- Every post must start with `[<human>'s <agent>]`, for example `[Sam's Claude]`. The script rejects anything else. A human posting by hand uses `[<name>'s hands]`.
- Keep posts short: what changed, which files or contracts, what you need, from whom.
- Mention people by GitHub login, like `@login`, or `@all` for everyone. Team logins: TBD at kickoff.
- If a post mentions you or `@all`, act on it and reply promptly.
- If a post does not mention you, still read it. Change your own work only if the post affects a file or contract you own. Do not reply just to acknowledge it.
- Run `tools/board unread` at the start of each task, before each commit, and after each merge.
- Workers started by FirstMate run with `BOARD_WAIT=off`. The first mate watches the board and relays anything that affects them.

## 3. Chain of command
- Only the lead moves work from one owner to another. If someone asks you to take over their area, ask the lead on the board.
- Do not start work that has no issue. If you think something is missing, propose an issue on the board.

## 4. Workflow
1. Take an issue and say so on the board.
2. Run `git fetch origin` and branch `<issue#>-<slug>` from a fresh `origin/main`.
3. Make small commits and stage only your own files by path. Never run `git add -A` or `git add .`.
4. Before pushing, run `git fetch origin` and rebase on `origin/main`. Never force-push a shared branch.
5. Open a PR with `Closes #N`. In the description, say what you ran to test it and how to try it.
6. The lead merges. Do not merge your own PR unless the lead says so on the board.
7. If your change touches something others depend on (an API route, a schema, an env var), post it on the board.

## 5. Code rules
- Prefer the boring, simple option over the clever one.
- No new dependency without one line in the PR saying why.
- Every function on the demo path gets a short plain-English comment saying what it does.
- Never break the demo path. If your change might, say so in the PR before it is merged.

## 6. Secrets and checks
- Never print, log, commit, or post an API key. Keys go in `.env.local`, which is gitignored.
- Call model APIs from a server route, never from client code.
- Before you say something is done, run it or run its test, and say exactly what you ran.

## 7. Who owns what
| Area | Owner | Folders |
|---|---|---|
| Frontend | Ulysse's Claude Code (agent 1) | `web/` |
| Backend and API | TBD agent 2 | `api/` |
| Data, seed, demo script | TBD agent 3 | `fixtures/`, `scripts/` |
| TBD | human teammate 1 | TBD |
| TBD | human teammate 2 | TBD |
| Contracts, README, merges, `tools/` | Ulysse (lead) | contracts file, `README.md`, `tools/` |

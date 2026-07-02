# visual-cursor — agent instructions

⌘-click any React component in the browser, describe a change in plain English, and a local Cursor agent edits the source file live via HMR. Dev-only npm package: a Vite plugin pair (`clickToSourceStamp` + `cursorAgent`) and a `<VisualCursor />` overlay. The [README](./README.md) is the North Star — read it before structural changes.

## Linear tracking (non-negotiable)

Every agent, every session. Linear workspace: **team "Off-brand"**, **project "visual-cursor"**. Structure already in place: milestones `v0.1 — Initial extraction` (done) / `Launch readiness` (active) / `Launch: rollout`; issue labels `stamp` / `agent` / `overlay` (under the `visual-cursor` label group); project label `Tool`. The tracking goal is **ship to npm and launch** — work that moves the launch forward matters most.

- **Search before creating.** Check for an existing issue match before filing anything new — never create a duplicate for work already tracked. Found a stale/duplicate issue? Mark it `Duplicate`, don't ignore it.
- **Non-trivial work gets an issue.** A real feature, fix, decision, or roadmap item gets a Linear issue in **visual-cursor**, filed as soon as the work is identified — before or at the start of work, not after. Trivial edits (typos, config tweaks) don't need one.
- **Every issue gets a milestone.** `Launch readiness` for pre-publish engineering/QA/assets work, `Launch: rollout` for announcement/marketing beats. An issue with no milestone is mis-filed.
- **Lifecycle is real, not decorative.** `Backlog` → `In Progress` the moment work starts → `Done` only once actually shipped (merged to `main`, checks pass, verified working). Never jump straight to `Done`; never leave active work sitting in `Backlog`. Session ending before something's finished? Leave it `In Progress` with a comment on what's left.
- **Label by module:** `stamp` (src/stamp.ts — the data-loc transform), `agent` (src/agent.ts — middleware + @cursor/sdk + undo/redo), `overlay` (src/client.tsx — ring + composer). Repo-wide work (CI, packaging, docs) goes unlabeled.
- **Wire real dependencies** (`blockedBy`/`blocks`) for genuine sequencing — e.g. the launch tweet is blocked by npm publish + website + assets. Don't leave sequencing as tribal knowledge.
- **Close the loop before ending a session.** If tracked work happened, update the issue (state and/or a short comment) before finishing. Shipping something but leaving Linear stale is not done.
- **Status updates at real milestones only.** Post a project status update when a milestone completes or health materially changes — not for routine incremental work.
- **Use Linear's generated branch names** (`ty/off-N-slug`) so commits/PRs auto-link — never hand-roll a parallel scheme.

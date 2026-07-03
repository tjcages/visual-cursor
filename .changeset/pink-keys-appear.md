---
"visual-cursor": minor
---

First-run key setup: when no `CURSOR_API_KEY` is found, the overlay shows a dismissible one-time modal to paste one. Saving writes it to `.dev.vars` (local-only; the file is gitignored automatically) via a new loopback-guarded `/__key` dev-server endpoint, and the agent picks it up immediately — no restart. Dismissal is remembered per dev-server start; manual setup (env var or editing `.dev.vars`) keeps working unchanged.

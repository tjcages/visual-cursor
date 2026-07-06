---
"visual-cursor": minor
---

Hardened + much lighter package. All dev endpoints (`/__agent`, `/__undo`, `/__redo`, `/__key`) now refuse cross-site browser requests (CSRF — a malicious website in your browser could previously reach them through loopback) in addition to the non-loopback guard (`allowRemote` still opts out of the latter only). Stamping now covers `.jsx` as well as `.tsx`, so plain-JavaScript React apps work. `@cursor/sdk` is a true optional peer dependency (install it yourself for the agent feature) and `typescript` is no longer force-installed on consumers; shipped sourcemaps were dropped — the tarball goes from 52 kB to 21 kB. The overlay client was decomposed into focused modules (`theme` / `panel` / `key-setup`) with no behavior change.

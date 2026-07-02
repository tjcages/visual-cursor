# visual-cursor

Hold **⌘** and hover any React component in your running app to highlight it. **⌘-click** it to open a small composer — type a change in plain English, and a local [Cursor](https://cursor.com) agent edits the source file on disk. Vite's HMR reflects the change live, right where you clicked. **⌘Z** / **⌘⇧Z** undo/redo the agent's edits. Open as many composer panels as you like; each keeps its own threaded conversation so you can keep refining ("make it blue" → "actually, more compact").

This is a dev-only tool — it does nothing in a production build.

> **⚠️ Security: localhost only.** The `/__agent`, `/__undo`, `/__redo` endpoints are
> **unauthenticated** — a POST to `/__agent` turns into an arbitrary edit to a file on disk.
> That's the point (it's how the browser talks to the agent), but it means anyone who can
> reach your dev server can edit your repo. By default `cursorAgent()` refuses any request
> that didn't arrive over loopback (`127.0.0.1`/`::1`), so this is safe with plain `vite dev`.
> **It stops being safe** the moment your dev server is reachable from anywhere else —
> `vite --host`, a container with a published port, an ngrok/Cloudflare tunnel, a shared
> devcontainer. Don't do that with this plugin enabled unless the network path is itself
> authenticated and you trust everyone on it (`allowRemote: true` opts out of the guard —
> see [`AgentOptions`](#agentoptions) below).

## How it works

- A Vite plugin (`clickToSourceStamp`) stamps every element you author with a `data-loc="file:line:col"` attribute at dev-transform time, plus `Component.__loc` on every top-level component so clicks resolve even through portals (Radix `asChild`, dropdowns rendered to `<body>`, etc).
- A `<VisualCursor />` React component (mounted once, dev-only) reads those stamps off the React fiber tree under the cursor, and renders the ⌘-hover ring + the composer panel.
- A second Vite plugin (`cursorAgent`) adds `/__agent`, `/__undo`, `/__redo` middleware to the dev server. Submitting a composer POSTs the file/line/instruction to `/__agent`, which runs a [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk) `Agent` scoped to that one file and streams progress back as NDJSON. Every turn is snapshotted (`git stash create`) so ⌘Z can restore the exact pre-edit file contents, and every changed file is syntax-checked before being accepted — a broken edit is auto-reverted instead of white-screening your app.

## Install

```bash
npm install visual-cursor @cursor/sdk
```

`@cursor/sdk` is an optional peer dependency — only required if you use the agent-editing feature (`cursorAgent`); the stamping + inspector overlay works without it. Note: `@cursor/sdk` itself requires **Node ≥22.13** — on an older Node, npm silently skips installing it (so `cursorAgent()` will report a missing package at runtime, and any code that type-imports it will fail to resolve types). Everything else in this package works on Node ≥18.

## Setup

**1. Wire the Vite plugins** (`vite.config.ts`) — put `visualCursor()` before your framework's own plugin so its `enforce: "pre"` transform runs first:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualCursor } from "visual-cursor";

export default defineConfig({
  plugins: [
    ...visualCursor({
      sourceDir: "src", // directory to stamp with data-loc — default "src"
    }),
    react(),
  ],
});
```

**2. Mount the overlay**, dev-only, near the root of your app:

```tsx
import { VisualCursor } from "visual-cursor/client";

export function App() {
  return (
    <>
      {/* ...your app... */}
      {import.meta.env.DEV && <VisualCursor />}
    </>
  );
}
```

**3. Set your Cursor API key** as `CURSOR_API_KEY` (env var, or in a `.dev.vars` file at the repo root — either works out of the box).

Run your dev server, hold ⌘, hover a component, and ⌘-click it.

## API

### `visualCursor(options?)`

Returns both Vite plugins (`cursorAgent()` + `clickToSourceStamp()`) as an array — spread into `plugins`. Options are the union of `StampOptions` and `AgentOptions` below. Use `clickToSourceStamp()` / `cursorAgent()` individually if you want to configure or omit one.

#### `StampOptions`

| option      | default   | description                                                              |
| ----------- | --------- | ------------------------------------------------------------------------- |
| `sourceDir` | `"src"`   | Directory (relative to the project root) to stamp with `data-loc`.        |
| `envFlag`   | `null`    | Gate stamping behind an env var (e.g. `"INSPECT"`) instead of always-on in dev. |

#### `AgentOptions`

| option        | default              | description                                                                 |
| ------------- | -------------------- | ---------------------------------------------------------------------------- |
| `apiKeyEnv`   | `"CURSOR_API_KEY"`   | Env var name to read the Cursor API key from.                                |
| `devVarsFile` | `".dev.vars"`        | A dotenv-style file also checked for the key (set `null` to disable).        |
| `model`       | `"composer-2.5"`     | Cursor Agent model id.                                                       |
| `maxThreads`  | `24`                 | Max concurrently-held agent threads before the oldest is disposed.           |
| `allowRemote` | `false`              | Accept `/__agent`/`/__undo`/`/__redo` requests from outside localhost. **See the security warning above before enabling this.** |

### `<VisualCursor />` (from `visual-cursor/client`)

| prop           | default    | description                                                                          |
| -------------- | ---------- | ------------------------------------------------------------------------------------- |
| `editor`       | `"cursor"` | `"cursor"` \| `"vscode"` — which `editor://file/...` URL scheme to open files with.   |
| `repoRoot`     | —          | Absolute repo path, so opened files resolve to an absolute path. Optional.            |
| `skipPrefixes` | `[]`       | `__loc` prefixes to skip when resolving a click (e.g. your design system's primitives dir, like `["src/components/ui/"]`), so a click lands on your own component. |

`ClickToSource` is exported as a deprecated alias of `VisualCursor`.

## Example

[`examples/vite-react`](./examples/vite-react) is a minimal working app wired up end to end —
clone the repo, `npm run build`, then `cd examples/vite-react && npm install && INSPECT=1 npm run dev`.

## Notes

- **Never committed / logged**: the API key is only read server-side, in the dev-server process.
- Undo/redo is per dev-server session (in-memory), not persisted across restarts.
- The agent is constrained to edit only the one file it was scoped to.

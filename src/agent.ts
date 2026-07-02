// Dev-only agentic in-context editing. The browser inspector (⌘-click a
// component → describe a change) POSTs { file, line, component, instruction,
// threadId? } to /__agent; this Node-side Vite middleware runs a local Cursor
// agent scoped to that file and streams progress back as NDJSON. The agent edits
// the file on disk → Vite HMR reflects it live. Passing a threadId back on a
// follow-up reuses the SAME agent, so the conversation keeps its context ("make
// it blue" → "actually, more compact"). Reads the API key from an env var
// (never logged). Only mounted in dev (`apply: "serve"`).

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Plugin } from "vite";

function readEnvFile(root: string, file: string, name: string): string | undefined {
  try {
    const txt = fs.readFileSync(path.join(root, file), "utf8");
    for (const line of txt.split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      if (line.slice(0, eq).trim() === name)
        return line
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
    }
  } catch {
    /* file not present */
  }
  return undefined;
}

type Body = {
  file?: string;
  line?: number;
  component?: string;
  instruction?: string;
  threadId?: string;
};

function firstPrompt(b: Body): string {
  return [
    `Edit the file \`${b.file}\` in this repository.`,
    b.component
      ? `It renders the \`${b.component}\` component (around line ${b.line ?? 1}).`
      : `Focus around line ${b.line ?? 1}.`,
    `Make exactly this change to that component: "${b.instruction}".`,
    `Constraints: only edit \`${b.file}\`; keep the component's props, exports, and behaviour;`,
    `match the surrounding code style; make the smallest edit that satisfies the request;`,
    `do not add explanatory comments.`,
  ].join(" ");
}

function followUpPrompt(b: Body): string {
  return [
    `Continue refining \`${b.file}\` — follow-up on your previous change: "${b.instruction}".`,
    `Same constraints: only that file, keep props/exports, smallest edit, no explanatory comments.`,
  ].join(" ");
}

export type AgentOptions = {
  /**
   * Env var name to read the Cursor API key from. Checked in `process.env`
   * first, then in `devVarsFile` (if set). @default "CURSOR_API_KEY"
   */
  apiKeyEnv?: string;
  /** A dotenv-style file to also check for the API key. @default ".dev.vars" */
  devVarsFile?: string | null;
  /** Cursor Agent model id. @default "composer-2.5" */
  model?: string;
  /** Max concurrently held agent threads before the oldest is disposed. @default 24 */
  maxThreads?: number;
};

// Live agents keyed by thread id (agentId). Held for the dev server's lifetime;
// capped so idle threads get disposed. Dev-only, so memory pressure is a non-issue.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreadEntry = { agent: any; last: number };

// Undo/redo of the agent's file edits. Each turn snapshots the working tree
// (git stash-create) before running; afterwards we diff to capture the exact
// before/after content of every file that changed, so ⌘Z / ⌘⇧Z can restore it.
type Snap = { files: { path: string; pre: string | null; post: string | null }[] };

function gitSnapshot(root: string): string | null {
  try {
    const s = execSync("git stash create", { cwd: root, encoding: "utf8" }).trim();
    return s || execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function captureChanges(root: string, pre: string | null): Snap | null {
  if (!pre) return null;
  let changed: string[] = [];
  try {
    changed = execSync(`git diff --name-only ${pre} --`, { cwd: root, encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    /* ignore */
  }
  const files: Snap["files"] = [];
  for (const f of changed) {
    let preC: string | null = null;
    let postC: string | null = null;
    try {
      preC = execSync(`git show ${pre}:${f}`, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
    } catch {
      /* new file */
    }
    try {
      postC = fs.readFileSync(path.join(root, f), "utf8");
    } catch {
      /* deleted */
    }
    files.push({ path: f, pre: preC, post: postC });
  }
  return files.length ? { files } : null;
}

// Parse each changed source file with the TypeScript compiler — returns the
// first file with a syntax error so a broken edit can be rolled back. Only
// syntax (single-file transpile); type/runtime errors aren't caught here (⌘Z is
// the fallback for those).
async function checkSyntax(snap: Snap): Promise<{ file: string; message: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ts: any;
  try {
    const m = await import("typescript");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ts = (m as any).default ?? m;
  } catch {
    return null; // no compiler → skip rather than block
  }
  const codeExt = new Set([".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"]);
  for (const f of snap.files) {
    if (f.post === null) continue; // deleted
    if (!codeExt.has(path.extname(f.path))) continue;
    const out = ts.transpileModule(f.post, {
      compilerOptions: {
        jsx: ts.JsxEmit.Preserve,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        isolatedModules: true,
      },
      fileName: f.path,
      reportDiagnostics: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = (out.diagnostics ?? []).find((d: any) => d.category === ts.DiagnosticCategory.Error);
    if (err) return { file: f.path, message: ts.flattenDiagnosticMessageText(err.messageText, " ").slice(0, 160) };
  }
  return null;
}

function applySnap(root: string, snap: Snap, key: "pre" | "post") {
  for (const f of snap.files) {
    const abs = path.join(root, f.path);
    const content = f[key];
    if (content === null) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* already gone */
      }
    } else {
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
      } catch {
        /* ignore */
      }
    }
  }
}

export function cursorAgent(options: AgentOptions = {}): Plugin {
  const {
    apiKeyEnv = "CURSOR_API_KEY",
    devVarsFile = ".dev.vars",
    model = "composer-2.5",
    maxThreads = 24,
  } = options;
  const root = process.cwd();
  const threads = new Map<string, ThreadEntry>();
  const undoStack: Snap[] = [];
  const redoStack: Snap[] = [];

  return {
    name: "visual-cursor:agent",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__agent", async (req, res, next) => {
        if (req.method !== "POST") return next();
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        await new Promise((r) => req.on("end", r));
        let body: Body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          /* bad json */
        }

        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const write = (o: any) => res.write(JSON.stringify(o) + "\n");

        const apiKey = process.env[apiKeyEnv] ?? (devVarsFile ? readEnvFile(root, devVarsFile, apiKeyEnv) : undefined);
        if (!apiKey) {
          write({ type: "error", message: `No ${apiKeyEnv} set (checked process.env${devVarsFile ? ` and ${devVarsFile}` : ""})` });
          return res.end();
        }
        if (!body.instruction) {
          write({ type: "error", message: "instruction required" });
          return res.end();
        }

        try {
          const { Agent } = await import("@cursor/sdk");
          const existing = body.threadId ? threads.get(body.threadId) : undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let agent: any;
          let id: string;
          let followUp = false;
          if (existing) {
            agent = existing.agent;
            existing.last = Date.now();
            id = body.threadId!;
            followUp = true;
          } else {
            if (!body.file) {
              write({ type: "error", message: "file required to start a thread" });
              return res.end();
            }
            agent = await Agent.create({
              apiKey,
              model: { id: model },
              local: { cwd: root },
            });
            id = agent.agentId ?? randomUUID();
            threads.set(id, { agent, last: Date.now() });
            if (threads.size > maxThreads) {
              const oldest = [...threads.entries()].sort((a, b) => a[1].last - b[1].last)[0];
              try {
                await oldest[1].agent[Symbol.asyncDispose]?.();
              } catch {
                /* ignore */
              }
              threads.delete(oldest[0]);
            }
          }
          write({ type: "thread", id });
          write({ type: "status", message: followUp ? "Refining…" : `Editing ${body.file}…` });

          const pre = gitSnapshot(root);
          const run = await agent.send(followUp ? followUpPrompt(body) : firstPrompt(body));
          let events = 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for await (const event of run.stream() as AsyncIterable<any>) {
            events++;
            if (event?.type === "assistant") {
              for (const blk of event.message?.content ?? [])
                if (blk?.type === "text" && blk.text) write({ type: "text", text: blk.text });
            } else if (event?.type === "tool_call") {
              write({
                type: "tool",
                name: event.name ?? event.tool ?? event.toolName ?? "tool",
                status: event.status,
              });
            }
          }
          const snap = captureChanges(root, pre);
          if (snap) {
            // Safety net: syntax-check every changed file. If the agent left a
            // broken parse (the thing that white-screens the app), auto-revert the
            // whole turn so the working tree never ends up broken.
            const broken = await checkSyntax(snap);
            if (broken) {
              applySnap(root, snap, "pre");
              write({ type: "error", message: `Reverted — the change broke ${broken.file}: ${broken.message}` });
              return res.end();
            }
            undoStack.push(snap);
            redoStack.length = 0;
          }
          // An empty stream means the agent connection went stale (a known issue
          // on a long-lived dev server) — surface it instead of faking success.
          if (events === 0 && !snap) {
            if (body.threadId) threads.delete(body.threadId); // drop the dead agent
            write({ type: "error", message: "No response from the agent — try again." });
          } else {
            write({ type: "done" });
          }
        } catch (e) {
          write({ type: "error", message: String((e as Error)?.message ?? e) });
        }
        res.end();
      });

      // ⌘Z / ⌘⇧Z — restore the working tree to before/after the last agent turn.
      const history = (from: Snap[], to: Snap[], key: "pre" | "post") =>
        (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
          res.setHeader("Content-Type", "application/json");
          const snap = from.pop();
          if (!snap) return res.end(JSON.stringify({ ok: false, empty: true }));
          applySnap(root, snap, key);
          to.push(snap);
          res.end(JSON.stringify({ ok: true, files: snap.files.length }));
        };
      server.middlewares.use("/__undo", (req, res, next) =>
        req.method === "POST" ? history(undoStack, redoStack, "pre")(req, res) : next()
      );
      server.middlewares.use("/__redo", (req, res, next) =>
        req.method === "POST" ? history(redoStack, undoStack, "post")(req, res) : next()
      );
    },
  };
}

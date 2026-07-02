import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

// `cursorAgent()` dynamically `import("@cursor/sdk")`s inside the /__agent
// handler — mock it so a "turn" is just "write some bytes to the target
// file", which is exactly what the real SDK does out-of-band on disk. That
// lets us exercise the real git-snapshot / undo / redo / syntax-check logic
// without a network call or an API key.
let nextWrite: { file: string; content: string } | null = null;
vi.mock("@cursor/sdk", () => ({
  Agent: {
    create: async () => ({
      agentId: "test-agent",
      send: async () => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stream: async function* (): AsyncGenerator<any> {
          if (nextWrite) fs.writeFileSync(nextWrite.file, nextWrite.content);
          yield { type: "assistant", message: { content: [{ type: "text", text: "done" }] } };
        },
      }),
    }),
  },
}));

function fakeReq(body: unknown): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  req.method = "POST";
  // @ts-expect-error - test double
  req.socket = { remoteAddress: "127.0.0.1" };
  queueMicrotask(() => {
    req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
  return req;
}

function fakeRes(): ServerResponse & { chunks: string[]; statusCode: number } {
  const chunks: string[] = [];
  return {
    chunks,
    statusCode: 200,
    setHeader() {},
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function ndjson(res: { chunks: string[] }) {
  return res.chunks
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("cursorAgent middleware", () => {
  let root: string;
  let file: string;
  let middlewares: Record<string, (req: IncomingMessage, res: ServerResponse, next: () => void) => void>;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "visual-cursor-test-"));
    execSync("git init -q", { cwd: root });
    execSync('git config user.email "test@test.com"', { cwd: root });
    execSync('git config user.name "test"', { cwd: root });
    file = path.join(root, "Widget.tsx");
    fs.writeFileSync(file, "export const Widget = () => null;\n");
    execSync("git add -A && git commit -q -m init", { cwd: root });

    process.env.CURSOR_API_KEY = "test-key";
    const prevCwd = process.cwd();
    process.chdir(root);

    const { cursorAgent } = await import("../agent");
    const plugin = cursorAgent();
    middlewares = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.configureServer as any)({
      middlewares: {
        use: (route: string, fn: typeof middlewares extends Record<string, infer F> ? F : never) => {
          middlewares[route] = fn;
        },
      },
    });
    process.chdir(prevCwd);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.CURSOR_API_KEY;
    nextWrite = null;
  });

  it("edits the file, and /__undo restores the pre-edit content", async () => {
    nextWrite = { file, content: "export const Widget = () => <div>edited</div>;\n" };

    const res = fakeRes();
    await middlewares["/__agent"](
      fakeReq({ file: "Widget.tsx", line: 1, instruction: "add a div" }),
      res,
      () => {}
    );

    const events = ndjson(res);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain("edited");

    const undoRes = fakeRes();
    await middlewares["/__undo"](fakeReq({}), undoRes, () => {});
    const undoBody = JSON.parse(undoRes.chunks.join(""));
    expect(undoBody.ok).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("export const Widget = () => null;\n");
  });

  it("/__redo re-applies what /__undo just reverted", async () => {
    nextWrite = { file, content: "export const Widget = () => <div>edited</div>;\n" };
    await middlewares["/__agent"](
      fakeReq({ file: "Widget.tsx", line: 1, instruction: "add a div" }),
      fakeRes(),
      () => {}
    );
    await middlewares["/__undo"](fakeReq({}), fakeRes(), () => {});
    expect(fs.readFileSync(file, "utf8")).toBe("export const Widget = () => null;\n");

    const redoRes = fakeRes();
    await middlewares["/__redo"](fakeReq({}), redoRes, () => {});
    const redoBody = JSON.parse(redoRes.chunks.join(""));
    expect(redoBody.ok).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain("edited");
  });

  it("/__undo on an empty stack reports empty, not an error", async () => {
    const res = fakeRes();
    await middlewares["/__undo"](fakeReq({}), res, () => {});
    const body = JSON.parse(res.chunks.join(""));
    expect(body).toEqual({ ok: false, empty: true });
  });

  it("auto-reverts a turn that leaves broken syntax", async () => {
    nextWrite = { file, content: "export const Widget = () => <div>>>>broken(((;\n" };

    const res = fakeRes();
    await middlewares["/__agent"](
      fakeReq({ file: "Widget.tsx", line: 1, instruction: "break it" }),
      res,
      () => {}
    );

    const events = ndjson(res);
    expect(events.some((e) => e.type === "error" && /Reverted/.test(e.message))).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("export const Widget = () => null;\n");
  });

  it("rejects a request without an instruction", async () => {
    const res = fakeRes();
    await middlewares["/__agent"](fakeReq({ file: "Widget.tsx" }), res, () => {});
    const events = ndjson(res);
    expect(events).toEqual([{ type: "error", message: "instruction required" }]);
  });

  it("rejects a non-loopback request with 403 before touching the body", async () => {
    const res = fakeRes();
    const req = fakeReq({ file: "Widget.tsx", instruction: "x" });
    // @ts-expect-error - test double
    req.socket = { remoteAddress: "203.0.113.5" };
    await middlewares["/__agent"](req, res, () => {});
    expect(res.statusCode).toBe(403);
  });
});

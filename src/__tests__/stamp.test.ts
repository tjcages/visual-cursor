import { describe, expect, it } from "vitest";
import path from "node:path";
import { clickToSourceStamp } from "../stamp";

// `clickToSourceStamp()` returns a Vite Plugin object whose `transform` hook
// we can call directly, bypassing Vite itself.
function transform(code: string, opts: Parameters<typeof clickToSourceStamp>[0] = {}) {
  const plugin = clickToSourceStamp(opts);
  const root = process.cwd();
  const sourceDir = opts.sourceDir ?? "src";
  const id = path.join(root, sourceDir, "Widget.tsx");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (plugin.transform as any).call({}, code, id);
  return result as { code: string } | null;
}

describe("clickToSourceStamp", () => {
  it("stamps intrinsic JSX elements with data-loc", () => {
    const out = transform(`export function Widget() {\n  return <div className="a">hi</div>;\n}\n`);
    expect(out?.code).toMatch(/data-loc="src\/Widget\.tsx:2:10"/);
  });

  it("does not double-stamp an element that already has data-loc", () => {
    const out = transform(`export function Widget() {\n  return <div data-loc="already">hi</div>;\n}\n`);
    const matches = out?.code.match(/data-loc=/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("does not stamp component (PascalCase) elements, only intrinsics", () => {
    const out = transform(`export function Widget() {\n  return <Card />;\n}\n`);
    expect(out?.code).not.toContain("data-loc");
  });

  it("assigns __loc to a top-level function-declaration component", () => {
    const out = transform(`function Widget() {\n  return null;\n}\n`);
    expect(out?.code).toContain('Widget.__loc = "src/Widget.tsx:1"');
  });

  it("assigns __loc to a top-level const arrow-function component", () => {
    const out = transform(`const Widget = () => {\n  return null;\n};\n`);
    expect(out?.code).toContain('Widget.__loc = "src/Widget.tsx:1"');
  });

  it("assigns __loc to a named export of a component", () => {
    const out = transform(`export function Widget() {\n  return null;\n}\n`);
    expect(out?.code).toContain('Widget.__loc = "src/Widget.tsx:1"');
  });

  it("does not assign __loc for a default-exported function (unstable binding)", () => {
    const out = transform(`export default function Widget() {\n  return null;\n}\n`);
    expect(out?.code).not.toContain("__loc");
  });

  it("ignores lowercase (non-component) top-level bindings", () => {
    const out = transform(`function helper() {\n  return null;\n}\n`);
    expect(out?.code).not.toContain("__loc");
  });

  it("only transforms files under sourceDir", () => {
    const plugin = clickToSourceStamp({ sourceDir: "src" });
    const root = process.cwd();
    const id = path.join(root, "other", "Widget.tsx");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (plugin.transform as any).call({}, `export function Widget() { return <div />; }`, id);
    expect(result).toBeNull();
  });

  it("does not transform non-JSX (.ts / .js) files", () => {
    const plugin = clickToSourceStamp();
    const root = process.cwd();
    for (const name of ["widget.ts", "widget.js"]) {
      const id = path.join(root, "src", name);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (plugin.transform as any).call({}, `export const x = 1;`, id);
      expect(result).toBeNull();
    }
  });

  it("stamps .jsx files too (plain-JavaScript React apps)", () => {
    const plugin = clickToSourceStamp();
    const root = process.cwd();
    const id = path.join(root, "src", "Widget.jsx");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (plugin.transform as any).call({}, `export function Widget() {\n  return <div>hi</div>;\n}\n`, id);
    expect(result?.code).toMatch(/data-loc="src\/Widget\.jsx:2:10"/);
    expect(result?.code).toContain('Widget.__loc = "src/Widget.jsx:1"');
  });

  it("respects envFlag gating — no-op when the flag is unset", () => {
    const prev = process.env.INSPECT;
    delete process.env.INSPECT;
    try {
      const out = transform(`export function Widget() { return <div />; }`, { envFlag: "INSPECT" });
      expect(out).toBeNull();
    } finally {
      if (prev !== undefined) process.env.INSPECT = prev;
    }
  });

  it("respects envFlag gating — transforms when the flag is set", () => {
    const prev = process.env.INSPECT;
    process.env.INSPECT = "1";
    try {
      const out = transform(`export function Widget() { return <div />; }`, { envFlag: "INSPECT" });
      expect(out?.code).toContain("data-loc");
    } finally {
      if (prev === undefined) delete process.env.INSPECT;
      else process.env.INSPECT = prev;
    }
  });

  it("never throws on unparseable input — returns null instead", () => {
    expect(() => transform("this is not { valid js <<<")).not.toThrow();
    expect(transform("this is not { valid js <<<")).toBeNull();
  });
});

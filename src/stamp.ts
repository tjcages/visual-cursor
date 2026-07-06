// Dev-only "click to source": stamp every authored DOM element with a
// data-loc="<relpath>:<line>:<col>" attribute so the in-app inspector
// (./client.tsx) can ⌘-click → open it in the editor.
//
// Runs `enforce: pre` (before the framework's own transform) on your source
// directory only. Any parse failure silently skips that file — it can never
// break the build.

import path from "node:path";
import * as babel from "@babel/core";
import type { Plugin } from "vite";

// Two stamps per file:
//   1. `data-loc` on every intrinsic (lowercase) DOM element — the precise line.
//   2. `<Component>.__loc = "file:line"` on every authored component function —
//      so the inspector can resolve components whose entire DOM is rendered by a
//      library (Radix Select/DropdownMenu) or portaled to <body>, where there's
//      no nearby app-authored host element to land on.
function stampPlugin(relPath: string) {
  return function ({ types: t }: { types: typeof babel.types }) {
    const isPascal = (n: string) => /^[A-Z]/.test(n);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isFnInit = (n: any) =>
      n && (n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression");

    // { name, line } if this top-level statement declares a component, else null.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function componentDecl(node: any): { name: string; line: number } | null {
      if (!node.loc) return null;
      const line = node.loc.start.line;
      if (node.type === "FunctionDeclaration" && node.id && isPascal(node.id.name))
        return { name: node.id.name, line };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fromDecl = (d: any): { name: string; line: number } | null => {
        if (d?.type === "FunctionDeclaration" && d.id && isPascal(d.id.name))
          return { name: d.id.name, line };
        if (d?.type === "VariableDeclaration") {
          const dec = d.declarations[0];
          if (dec?.id?.type === "Identifier" && isPascal(dec.id.name) && isFnInit(dec.init))
            return { name: dec.id.name, line };
        }
        return null;
      };
      // Skip `export default function Foo` — the default-export binding doesn't
      // reliably survive some SSR transforms, so `Foo.__loc = …` can throw at
      // render ("Foo is not defined"). Route roots don't need it anyway; their
      // child elements + named components carry the stamps.
      if (node.type === "ExportDefaultDeclaration") return null;
      if (node.type === "ExportNamedDeclaration") return fromDecl(node.declaration);
      return fromDecl(node);
    }

    return {
      visitor: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Program(p: any) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const inserts: Array<{ stmt: any; name: string; line: number }> = [];
          for (const stmt of p.get("body")) {
            const info = componentDecl(stmt.node);
            if (info) inserts.push({ stmt, name: info.name, line: info.line });
          }
          for (const { stmt, name, line } of inserts) {
            stmt.insertAfter(
              t.expressionStatement(
                t.assignmentExpression(
                  "=",
                  t.memberExpression(t.identifier(name), t.identifier("__loc")),
                  t.stringLiteral(`${relPath}:${line}`)
                )
              )
            );
          }
        },
        JSXOpeningElement(p: { node: babel.types.JSXOpeningElement }) {
          const node = p.node;
          if (node.name.type !== "JSXIdentifier" || !/^[a-z]/.test(node.name.name)) return;
          if (!node.loc) return;
          const already = node.attributes.some(
            (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === "data-loc"
          );
          if (already) return;
          const value = `${relPath}:${node.loc.start.line}:${node.loc.start.column + 1}`;
          node.attributes.push(t.jsxAttribute(t.jsxIdentifier("data-loc"), t.stringLiteral(value)));
        },
      },
    };
  };
}

export type StampOptions = {
  /** Source directory to stamp, relative to the project root. @default "src" */
  sourceDir?: string;
  /**
   * Gate the transform behind an env var (e.g. only stamp when `INSPECT=1`).
   * Set to `null` to always stamp in dev. @default null
   */
  envFlag?: string | null;
};

export function clickToSourceStamp(options: StampOptions = {}): Plugin {
  const { sourceDir = "src", envFlag = null } = options;
  const root = process.cwd();
  const srcDirAbs = path.join(root, sourceDir) + path.sep;
  return {
    name: "visual-cursor:stamp",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      if (envFlag && !process.env[envFlag]) return null;
      const file = id.split("?")[0];
      if (!/\.[tj]sx$/.test(file) || !file.startsWith(srcDirAbs)) return null;
      const rel = path.relative(root, file);
      try {
        const result = babel.transformSync(code, {
          filename: file,
          babelrc: false,
          configFile: false,
          sourceMaps: true,
          parserOpts: { plugins: ["jsx", "typescript"] },
          plugins: [stampPlugin(rel)],
        });
        if (!result?.code) return null;
        return { code: result.code, map: result.map as never };
      } catch {
        return null; // never break dev over a stamp
      }
    },
  };
}

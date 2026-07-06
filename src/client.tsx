// Dev-only inspector + agentic editor. Hold ⌘ and hover to highlight the
// component under the cursor (a dim neutral ring, theme-aware); ⌘-click opens a
// composer panel (./panel.tsx): type a change and a local Cursor agent (the
// /__agent Vite middleware from this package) edits that file live (HMR),
// keeping a threaded conversation so you can keep refining. Every ⌘-click opens
// ANOTHER panel — open as many as you like. ⌘-Enter with an empty box opens the
// file in the editor. ⌘Z / ⌘⇧Z undo / redo the agent's edits. Resolution walks
// the React fiber tree (survives portals / asChild), skipping any
// `skipPrefixes` so clicks land on your own components. Inert when nothing is
// stamped. First run with no API key? ./key-setup.tsx offers a one-time modal.
//
// Mount `<VisualCursor />` once, dev-only, near the root of your app:
//
//   {import.meta.env.DEV && <VisualCursor />}
//
// Requires the `visualCursor()` Vite plugin (see the package root export) to
// be wired into `vite.config.ts` so elements get stamped with `data-loc`.

import { useCallback, useEffect, useRef, useState } from "react";
import { KeySetup } from "./key-setup";
import { PILL_STRIDE, PanelCard, type Panel } from "./panel";
import { isPageDark } from "./theme";

type Box = { x: number; y: number; w: number; h: number; label: string; dark: boolean };
type Hit = { el: Element; loc: string };

const nameOf = (loc: string) => loc.split(":")[0].split("/").pop()!.replace(/\.(tsx|ts|jsx|js)$/, "");

const componentLabel = (loc: string) => {
  const [file, line] = loc.split(":");
  const base = file.split("/").pop()!.replace(/\.(tsx|ts|jsx|js)$/, "");
  return line ? `${base}:${line}` : base;
};

// A click landing inside any open panel/chip shouldn't dismiss or re-open one.
const insidePanel = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-vc-panel]");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFiber(node: any): any {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  return key ? node[key] : null;
}

// Nearest stamped host element (precise), else nearest authored component's
// __loc — skipping any of `skipPrefixes` (e.g. a shadcn/Radix primitives dir).
function resolve(target: EventTarget | null, skipPrefixes: string[]): Hit | null {
  if (!(target instanceof Element)) return null;
  let fiber = getFiber(target);
  if (!fiber) {
    const el = target.closest("[data-loc]");
    return el ? { el, loc: el.getAttribute("data-loc")! } : null;
  }
  const hostEl: Element = target;
  while (fiber) {
    const sn = fiber.stateNode;
    if (sn instanceof Element) {
      const dl = sn.getAttribute("data-loc");
      if (dl) return { el: sn, loc: dl };
    }
    const type = fiber.type;
    const loc = (typeof type === "function" && type.__loc) || type?.render?.__loc || type?.type?.__loc;
    if (loc && !skipPrefixes.some((p) => String(loc).startsWith(p))) return { el: hostEl, loc };
    fiber = fiber.return;
  }
  return null;
}

const KEYFRAMES = `
@keyframes vc-spin{to{transform:rotate(360deg)}}
@keyframes vc-in{from{opacity:0;transform:translateY(6px);filter:blur(3px)}to{opacity:1;transform:translateY(0);filter:blur(0)}}
@keyframes vc-pop{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}
@keyframes vc-rise{from{opacity:0;transform:translateY(5px);filter:blur(2px)}to{opacity:1;transform:translateY(0);filter:blur(0)}}
@keyframes vc-ring{from{opacity:0}to{opacity:1}}
@keyframes vc-toast{0%{opacity:0;transform:translateY(6px)}18%{opacity:1;transform:translateY(0)}80%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-3px)}}
.vc-press{transition:transform .15s cubic-bezier(0.22,1,0.36,1)}
.vc-press:active{transform:scale(.96)}
@media (prefers-reduced-motion:reduce){.vc-overlay *{animation:none !important;transition-duration:.001ms !important}.vc-overlay .vc-spin{animation:vc-spin .7s linear infinite !important}}
`;

export type VisualCursorProps = {
  /** Editor URL scheme to open files in. @default "cursor" */
  editor?: "cursor" | "vscode";
  /** Absolute path to the repo root, so opened files resolve. If omitted, a
   *  relative `editor://file/<loc>` URL is used (works when the editor is
   *  already scoped to this repo). */
  repoRoot?: string;
  /** __loc prefixes to skip when walking the fiber tree — e.g. your design
   *  system's primitive components dir, so a click lands on your component
   *  instead. @default [] */
  skipPrefixes?: string[];
};

export function VisualCursor({ editor = "cursor", repoRoot, skipPrefixes = [] }: VisualCursorProps = {}) {
  const [box, setBox] = useState<Box | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [flash, setFlash] = useState<{ msg: string; n: number } | null>(null); // undo/redo toast (n bumps to replay)
  const [minIds, setMinIds] = useState<number[]>([]); // minimized panels, in stack order
  const idRef = useRef(0);
  const flashTimer = useRef<number>(0);

  function showFlash(msg: string) {
    setFlash((f) => ({ msg, n: (f?.n ?? 0) + 1 }));
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1500);
  }

  // Children report their minimized state so the stack of pills can offset each
  // one and the toast can sit above them.
  const reportMinimized = useCallback((id: number, min: boolean) => {
    setMinIds((ids) => (min ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((x) => x !== id)));
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!e.metaKey || insidePanel(e.target)) return setBox((b) => (b ? null : b));
      const hit = resolve(e.target, skipPrefixes);
      if (!hit) return setBox(null);
      const r = hit.el.getBoundingClientRect();
      setBox({ x: r.left, y: r.top, w: r.width, h: r.height, label: componentLabel(hit.loc), dark: isPageDark() });
    }
    function onClick(e: MouseEvent) {
      if (!e.metaKey || insidePanel(e.target)) return; // opens only; dismiss is per-panel
      const hit = resolve(e.target, skipPrefixes);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      setBox(null);
      const id = ++idRef.current;
      setPanels((ps) => [
        ...ps,
        { id, loc: hit.loc, name: nameOf(hit.loc), x: e.clientX, y: e.clientY, dark: isPageDark(), el: hit.el },
      ]);
    }
    async function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key.toLowerCase() === "z") {
        const ae = document.activeElement as HTMLElement | null;
        const inOtherField =
          ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable) && !ae.closest?.("[data-vc-panel]");
        if (inOtherField) return;
        e.preventDefault();
        const redo = e.shiftKey;
        try {
          const r = await fetch(redo ? "/__redo" : "/__undo", { method: "POST" });
          const d = (await r.json()) as { ok: boolean; empty?: boolean };
          showFlash(d.ok ? (redo ? "Redone" : "Undone") : redo ? "Nothing to redo" : "Nothing to undo");
        } catch {
          showFlash("Undo failed");
        }
      }
    }
    const clearHover = () => setBox(null);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", clearHover);
    window.addEventListener("blur", clearHover);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", clearHover);
      window.removeEventListener("blur", clearHover);
    };
  }, [skipPrefixes]);

  const hoverRing = box?.dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.4)";
  const hoverBg = box?.dark ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.04)";

  return (
    <div className="vc-overlay" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 2147483647 }}>
      <style>{KEYFRAMES}</style>

      {box && (
        <>
          <div
            style={{ position: "fixed", left: box.x, top: box.y, width: box.w, height: box.h, outline: `1px solid ${hoverRing}`, background: hoverBg, borderRadius: 4, animation: "vc-ring .14s ease-out" }}
          />
          <div
            style={{ position: "fixed", left: box.x, top: Math.max(0, box.y - 20), background: box.dark ? "rgba(0,0,0,0.8)" : "rgba(30,30,30,0.9)", color: "#f1f1f1", font: "10px ui-monospace, SFMono-Regular, monospace", padding: "2px 5px", borderRadius: 4, whiteSpace: "nowrap", animation: "vc-ring .14s ease-out" }}
          >
            {box.label}
          </div>
        </>
      )}

      {flash && (
        <div
          key={flash.n}
          style={{ position: "fixed", right: 16, bottom: 16 + minIds.length * PILL_STRIDE, pointerEvents: "none", background: "#111", color: "#fff", font: "12.5px ui-sans-serif, system-ui", fontWeight: 500, padding: "8px 13px", borderRadius: 999, boxShadow: "0 8px 24px rgba(0,0,0,0.28)", animation: "vc-toast 1.5s cubic-bezier(0.16,1,0.3,1) forwards" }}
        >
          {flash.msg}
        </div>
      )}

      <KeySetup />

      {panels.map((p) => (
        <PanelCard
          key={p.id}
          panel={p}
          editor={editor}
          repoRoot={repoRoot}
          stackIndex={Math.max(0, minIds.indexOf(p.id))}
          onMinimized={reportMinimized}
          onClose={() => setPanels((ps) => ps.filter((x) => x.id !== p.id))}
        />
      ))}
    </div>
  );
}

// Deprecated alias — kept for a smooth migration from the click-to-source name.
export const ClickToSource = VisualCursor;

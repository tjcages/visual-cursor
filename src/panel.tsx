// One independent composer panel. Owns its own conversation, phase, position,
// and minimized/closing lifecycle — so any number of these can be open at
// once. Rendered by <VisualCursor /> (./client.tsx), one per ⌘-click; talks to
// the /__agent middleware and streams the run back as NDJSON.

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FONT, palette } from "./theme";

export const PILL_STRIDE = 44; // vertical spacing between stacked minimized pills / the toast

export type Panel = { id: number; loc: string; name: string; x: number; y: number; dark: boolean; el: Element };
type Phase = "idle" | "busy" | "done" | "error";
type Turn = { you: string; agent: string; phase: Phase };

// Strip markdown / code fences so a streamed status reads as one plain line.
const clean = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function PanelCard({
  panel,
  editor,
  repoRoot,
  stackIndex,
  onMinimized,
  onClose,
}: {
  panel: Panel;
  editor: "cursor" | "vscode";
  repoRoot?: string;
  stackIndex: number;
  onMinimized: (id: number, min: boolean) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [turn, setTurn] = useState<Turn | null>(null);
  const [docked, setDocked] = useState(false);
  const [minimized, setMinimized] = useState(false); // clicked away while working → pill
  const [dones, setDones] = useState<string[]>([]); // completed tasks, newest first (stacked above the input)
  const [closing, setClosing] = useState(false); // exit animation before unmount
  const [focused, setFocused] = useState(false); // input focused → spotlight the component
  const [spot, setSpot] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [lit, setLit] = useState(false); // overlay opacity — lags `focused` a frame so the fade always plays
  const [minH, setMinH] = useState<number>(); // the compact height at open — the panel never shrinks below it

  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const dockedRef = useRef(false);
  dockedRef.current = docked;
  const minimizedRef = useRef(false);
  minimizedRef.current = minimized;
  const promptRef = useRef("");
  promptRef.current = prompt;
  // Anchor to the exact element that was ⌘-clicked. The loc query is only a
  // fallback — it fails for components resolved by their function __loc (whose
  // line never matches a data-loc attribute), which is why some had no overlay.
  const anchorRef = useRef<Element | null>(panel.el);
  const threadRef = useRef<string | null>(null);
  const panelElRef = useRef<HTMLDivElement>(null);
  const chipElRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timers = useRef<number[]>([]);
  const historyRef = useRef<string[]>([]); // instructions sent this thread (Up/Down recall)
  const histIdxRef = useRef<number | null>(null); // null = new draft; else index into history
  const litRef = useRef(false);
  litRef.current = lit;
  const focusedRef = useRef(false);
  focusedRef.current = focused;

  const busy = phase === "busy";
  const typing = prompt.trim().length > 0;
  const showInput = !busy; // hidden only while thinking; on complete it returns under the done-summary
  const showBar = busy || typing; // [name ↗] … [stop when busy]
  const showTranscript = busy || phase === "error";

  const dk = panel.dark;
  const pal = palette(dk);
  const font = FONT;

  function closePanel() {
    // if the spotlight is currently up, fade it out first and hold the unmount
    // until that finishes so it doesn't just vanish; otherwise dismiss snappily.
    const overlayUp = litRef.current || focusedRef.current;
    setFocused(false); // starts the overlay fading out
    setClosing(true);
    timers.current.push(window.setTimeout(onClose, overlayUp ? 640 : 160));
  }

  // Clear timers / abort any run when this panel is removed.
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    abortRef.current?.abort();
  }, []);

  // Report minimized state up so the parent can stack the pills + offset the toast.
  useEffect(() => {
    onMinimized(panel.id, minimized);
    return () => onMinimized(panel.id, false);
  }, [minimized, panel.id, onMinimized]);

  // Focus the input whenever it (re)appears — on open, on reopen from the chip,
  // and when it returns after a run completes. autoFocus won't re-fire.
  useEffect(() => {
    if (showInput && !minimized) taRef.current?.focus({ preventScroll: true });
  }, [showInput, minimized]);

  // Track the edited component's rect while the panel is open (not just while
  // focused) so the overlay is already mounted at opacity 0 before focus — that
  // guarantees the fade transition runs instead of the element popping in at 1.
  // Only push a new rect when it actually moves, to avoid per-frame re-renders.
  useEffect(() => {
    if (minimized) return;
    let raf = 0;
    const tick = () => {
      let a = anchorRef.current;
      // some stamped nodes are zero-box (fragments / display:contents) — climb to
      // the nearest ancestor that actually has a rendered box so the spotlight shows.
      while (a && (a.getBoundingClientRect().width < 1 || a.getBoundingClientRect().height < 1) && a.parentElement) {
        a = a.parentElement;
      }
      if (a?.isConnected) {
        const r = a.getBoundingClientRect();
        setSpot((p) => (p && p.x === r.left && p.y === r.top && p.w === r.width && p.h === r.height ? p : { x: r.left, y: r.top, w: r.width, h: r.height }));
      } else {
        setSpot(null); // component gone — nothing to spotlight
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [minimized]);

  // Drive the overlay opacity. It lags `focused` by a beat on the way in so the
  // element paints at 0 first — guaranteeing the CSS opacity transition runs
  // (otherwise it mounts already at 1 and just pops). A timeout (not rAF) so it
  // still fires in a background tab. Fades out immediately on blur.
  useEffect(() => {
    if (!focused) {
      setLit(false);
      return;
    }
    const t = window.setTimeout(() => setLit(true), 50);
    return () => window.clearTimeout(t);
  }, [focused]);

  // Capture the compact height at open, then floor the panel to it — so it never
  // collapses smaller than it opened, even mid-transition from a completed run.
  useLayoutEffect(() => {
    if (!minimized && minH == null && panelElRef.current) setMinH(panelElRef.current.offsetHeight);
  }, [minimized, minH]);

  // Tapping out of this panel: minimize if it's working (so the run survives),
  // otherwise dismiss it — but only when it's blank (no unsent text). This keeps
  // idle empty panels from piling up as you ⌘-click around, while preserving any
  // panel you've actually typed into. A click inside THIS panel is never a tap-out
  // (clicking into another panel still counts, so blank ones there get cleared).
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (minimizedRef.current) {
        if (chipElRef.current?.contains(e.target as Node)) setMinimized(false);
        return;
      }
      if (panelElRef.current?.contains(e.target as Node)) return; // inside this panel
      if (phaseRef.current === "busy") return setMinimized(true); // keep the run alive
      if (dockedRef.current) return; // component's gone; leave the docked panel
      if (!promptRef.current.trim()) closePanel(); // blank + idle → dismiss like Esc
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || minimizedRef.current) return;
      if (document.activeElement !== taRef.current) return; // only the focused panel
      if (phaseRef.current === "busy") setMinimized(true);
      else closePanel();
    }
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the edited component: keep the panel at the spot (relative to the
  // component) where it opened and track it as the page scrolls, so it stays
  // close to what it's editing. Clamp to the viewport (also handles growth). Only
  // drop to the corner when the component is actually removed from the DOM (a
  // modal closes), springing there.
  useLayoutEffect(() => {
    if (minimized) return;
    const el = panelElRef.current;
    if (!el) return;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const a0 = anchorRef.current?.getBoundingClientRect();
    const offX = a0 ? panel.x - a0.left : 0;
    const offY = a0 ? panel.y + 8 - a0.top : 8;
    const alive = () => {
      if (anchorRef.current?.isConnected) return true;
      const found = document.querySelector(`[data-loc="${panel.loc}"]`);
      if (found) {
        anchorRef.current = found;
        return true;
      }
      return false;
    };
    let raf = 0;
    let wasAlive = true;
    let first = true;
    const tick = () => {
      const live = alive();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x: number;
      let y: number;
      if (live) {
        const r = anchorRef.current!.getBoundingClientRect();
        x = Math.round(Math.min(Math.max(8, r.left + offX), Math.max(8, window.innerWidth - w - 8)));
        y = Math.round(Math.min(Math.max(8, r.top + offY), Math.max(8, window.innerHeight - h - 8)));
      } else {
        x = window.innerWidth - w - 16;
        y = window.innerHeight - h - 16;
      }
      const cx = parseFloat(el.style.left);
      const cy = parseFloat(el.style.top);
      if (first || cx !== x || cy !== y) {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        // spring only on the drop to the corner (component removed); else track instantly
        if (!first && wasAlive && !live && !reduce && !Number.isNaN(cx)) {
          el.animate(
            [
              { left: `${cx}px`, top: `${cy}px` },
              { left: `${x}px`, top: `${y}px` },
            ],
            { duration: 460, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
          );
        }
      }
      if (dockedRef.current !== !live) setDocked(!live);
      wasAlive = live;
      first = false;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [panel, minimized]);

  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }

  function openFile() {
    window.location.href = `${editor}://file${repoRoot ?? ""}/${panel.loc}`;
  }

  function submit() {
    const instruction = prompt.trim();
    if (!instruction) return openFile(); // empty → open the file
    if (phase === "busy") return;
    if (historyRef.current[historyRef.current.length - 1] !== instruction) historyRef.current.push(instruction);
    histIdxRef.current = null;
    void run(instruction);
  }

  // Populate the input from history and drop the cursor at the end.
  function recall(v: string) {
    setPrompt(v);
    window.setTimeout(() => {
      const t = taRef.current;
      if (!t) return;
      t.setSelectionRange(t.value.length, t.value.length);
      t.style.height = "auto";
      t.style.height = `${Math.min(t.scrollHeight, 168)}px`;
    }, 0);
  }

  // Up/Down = message history (like a shell). Up recalls the previous message —
  // only from an empty draft with the caret at the start; Down walks back toward a
  // fresh empty message when the caret is at the end. Otherwise the arrows move the
  // caret normally.
  function onArrow(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const t = e.currentTarget;
    const hist = historyRef.current;
    if (e.key === "ArrowUp") {
      if (t.selectionStart !== 0 || t.selectionEnd !== 0) return;
      const idx = histIdxRef.current;
      if (idx === null) {
        if (prompt !== "" || hist.length === 0) return; // only from a blank new message
        e.preventDefault();
        histIdxRef.current = hist.length - 1;
        recall(hist[hist.length - 1]);
      } else if (idx > 0) {
        e.preventDefault();
        histIdxRef.current = idx - 1;
        recall(hist[idx - 1]);
      } else {
        e.preventDefault(); // already at the oldest
      }
    } else if (e.key === "ArrowDown") {
      if (histIdxRef.current === null) return; // a new draft — nothing below
      if (t.selectionStart !== prompt.length || t.selectionEnd !== prompt.length) return;
      e.preventDefault();
      const ni = histIdxRef.current + 1;
      if (ni >= hist.length) {
        histIdxRef.current = null;
        recall("");
      } else {
        histIdxRef.current = ni;
        recall(hist[ni]);
      }
    }
  }

  async function run(instruction: string) {
    const [file, lineStr] = panel.loc.split(":");
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPrompt("");
    if (taRef.current) taRef.current.style.height = "auto";
    setPhase("busy");
    setTurn({ you: instruction, agent: "Thinking…", phase: "busy" });
    let acc = "";
    let outcome: Phase = "done";
    const agent = (text: string, ph: Phase) => setTurn((t) => (t ? { ...t, agent: text, phase: ph } : t));
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/__agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, line: Number(lineStr) || 1, component: panel.name, instruction, threadId: threadRef.current }),
        signal: ac.signal,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const ln of lines) {
          if (!ln.trim()) continue;
          let ev: { type: string; id?: string; message?: string; name?: string; status?: string; text?: string };
          try {
            ev = JSON.parse(ln);
          } catch {
            continue;
          }
          if (ev.type === "thread" && ev.id) threadRef.current = ev.id;
          else if (ev.type === "text" && ev.text) {
            acc += ev.text;
            agent(clean(acc).slice(-140) || "Working…", "busy");
          } else if (ev.type === "tool" && ev.status === "running") {
            const label = { read: "Reading", edit: "Editing", write: "Writing", readLints: "Checking" }[ev.name ?? ""] ?? "Working";
            if (!acc) agent(`${label}…`, "busy");
          } else if (ev.type === "error") {
            outcome = "error";
            agent(clean(ev.message ?? "Something went wrong"), "error");
          }
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        outcome = "error";
        agent(clean(String((e as Error)?.message ?? e)).slice(0, 140), "error");
      }
    }
    abortRef.current = null;
    setPhase(outcome);
    if (outcome === "error") {
      if (minimizedRef.current) setMinimized(false); // pop back open so the error is visible
      taRef.current?.focus();
      return;
    }
    setTurn((t) => (t ? { ...t, phase: "done" } : t));
    if (minimizedRef.current) {
      // minimized pill: flash the checkmark for a beat, then fade out
      timers.current.push(window.setTimeout(() => closePanel(), 2400));
      return;
    }
    // open panel: stack the finished task above the input (newest on top), reopen for a follow-up
    setDones((d) => [instruction, ...d]);
    setTurn(null);
    taRef.current?.focus();
  }

  // ---- minimized: a pill in the bottom-right — loader on the left, the request
  //      on the right. Multiple stack upward. Click to reopen. ----
  if (minimized) {
    return (
      <div
        ref={chipElRef}
        data-vc-panel
        onClick={() => setMinimized(false)}
        className="vc-press"
        style={{ position: "fixed", zIndex: 2, right: 16, bottom: 16 + stackIndex * PILL_STRIDE, pointerEvents: "auto", display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 280, height: 34, padding: "0 12px 0 11px", borderRadius: 999, background: pal.bg, color: pal.fg, border: `1px solid ${pal.line}`, boxShadow: "0 6px 20px rgba(0,0,0,0.2)", cursor: "pointer", font, opacity: closing ? 0 : 1, transform: closing ? "scale(.94)" : "none", transition: "opacity .18s ease, transform .18s ease, bottom .28s cubic-bezier(0.16,1,0.3,1)", animation: closing ? undefined : "vc-pop .28s cubic-bezier(0.22,1,0.36,1)" }}
      >
        <span style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", width: 14, height: 14 }}>
          {phase === "done" ? (
            <span style={{ color: "#22a565", fontSize: 14 }}>✓</span>
          ) : phase === "error" ? (
            <span style={{ color: "#e5533c", fontSize: 13 }}>✕</span>
          ) : (
            <span className="vc-spin" style={{ width: 12, height: 12, border: "2px solid rgba(140,140,140,0.3)", borderTopColor: pal.sub, borderRadius: "50%", display: "inline-block", animation: "vc-spin .7s linear infinite" }} />
          )}
        </span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: pal.fg }}>
          {turn?.you ?? "…"}
        </span>
      </div>
    );
  }

  return (
    <>
      {/* focus mode — a radial gradient centred on the edited component: clear over
          it, darkening with distance. White in light mode, dark in dark mode.
          Fades in/out with the input's focus over ~1.4s. */}
      {spot &&
        (() => {
          const cx = Math.round(spot.x + spot.w / 2);
          const cy = Math.round(spot.y + spot.h / 2);
          // more extreme: only a thin clear halo around the component, and a much
          // steeper ramp so the page dims out close to it.
          const clear = Math.round(Math.max(spot.w, spot.h) / 2 + 20);
          const reach = Math.round(clear + Math.hypot(window.innerWidth, window.innerHeight) * 0.42);
          const rgb = dk ? "0,0,0" : "255,255,255";
          const maxA = dk ? 0.55 : 0.7; // dark: same as before; light: white
          return (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: `radial-gradient(circle at ${cx}px ${cy}px, rgba(${rgb},0) ${clear}px, rgba(${rgb},${maxA}) ${reach}px)`,
                pointerEvents: "none",
                zIndex: 1,
                opacity: lit ? 1 : 0,
                // ease-out both ways; the fade-OUT is ~2× faster than the fade-in
                transition: `opacity ${lit ? "1.4s" : "0.6s"} cubic-bezier(0.16, 1, 0.3, 1)`,
              }}
            />
          );
        })()}
      <div
        ref={panelElRef}
        data-vc-panel
        style={{ position: "fixed", zIndex: 2, width: 320, minHeight: minH, pointerEvents: "auto", background: pal.bg, color: pal.fg, border: `1px solid ${pal.line}`, borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.22)", font, padding: 4, opacity: closing ? 0 : 1, transform: closing ? "translateY(-6px)" : "none", filter: closing ? "blur(3px)" : "none", transition: "opacity .16s ease, transform .16s ease, filter .16s ease", animation: closing ? undefined : "vc-in .3s cubic-bezier(0.22,1,0.36,1)" }}
      >
      {/* finished tasks — dim summaries stacked above the input, newest on top */}
      {dones.map((task, i) => (
        <div key={dones.length - i} style={{ margin: "8px 8px 0", padding: "8px 10px", borderRadius: 10, background: pal.chip, display: "flex", alignItems: "center", gap: 8, animation: i === 0 ? "vc-rise .28s cubic-bezier(0.22,1,0.36,1)" : undefined }}>
          <span style={{ flex: "none", display: "inline-flex", width: 15, height: 15, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: pal.sub }}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke={pal.bg} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5 10 17 19 7" />
            </svg>
          </span>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: pal.fg, fontSize: 12.5 }}>{task}</span>
          <span style={{ flex: "none", color: pal.sub, fontSize: 11, fontWeight: 500 }}>Done</span>
        </div>
      ))}

      {/* current turn while thinking / on error */}
      {showTranscript && turn && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 12px 8px", animation: "vc-rise .28s cubic-bezier(0.22,1,0.36,1)" }}>
          <div style={{ color: pal.fg, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{turn.you}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: turn.phase === "error" ? "#e5533c" : pal.sub, lineHeight: 1.45 }}>
            {turn.phase === "busy" ? (
              <span className="vc-spin" style={{ width: 10, height: 10, border: "2px solid rgba(140,140,140,0.3)", borderTopColor: pal.sub, borderRadius: "50%", display: "inline-block", flex: "none", animation: "vc-spin .7s linear infinite" }} />
            ) : (
              <span style={{ flex: "none", color: "#e5533c" }}>✕</span>
            )}
            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{turn.agent}</span>
          </div>
        </div>
      )}

      {/* input — borderless; the right button morphs open-file (empty) ↔ send (typing) */}
      {showInput && (
        <div style={{ position: "relative", animation: "vc-rise .28s cubic-bezier(0.22,1,0.36,1)" }}>
          <textarea
            ref={taRef}
            autoFocus
            value={prompt}
            rows={1}
            onChange={(e) => {
              setPrompt(e.target.value);
              histIdxRef.current = null; // typing = a new draft, no longer browsing history
              autosize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                onArrow(e);
              }
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={dones.length ? "Ask a follow-up" : "Make agent changes."}
            style={{ width: "100%", boxSizing: "border-box", resize: "none", overflow: "hidden", background: "transparent", color: pal.fg, border: "none", padding: "11px 42px 11px 12px", outline: "none", font, lineHeight: 1.45, minHeight: 40 }}
          />
          <button
            type="button"
            onClick={() => (typing ? submit() : openFile())}
            title={typing ? "Send" : "Open file"}
            className="vc-press"
            style={{ position: "absolute", right: 8, top: 7, width: 26, height: 26, borderRadius: "50%", border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", background: typing ? pal.chip : dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)", color: typing ? pal.fg : pal.sub, cursor: "pointer", padding: 0, transition: "background-color .25s ease, color .25s ease" }}
          >
            {/* open-file ↗ (empty) and send ↑ (typing) cross-fade */}
            <span aria-hidden style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "opacity .26s cubic-bezier(0.2,0,0,1), transform .26s cubic-bezier(0.2,0,0,1)", opacity: typing ? 0 : 1, transform: typing ? "scale(.4)" : "scale(1)" }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17 17 7" />
                <path d="M8 7h9v9" />
              </svg>
            </span>
            <span aria-hidden style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "opacity .26s cubic-bezier(0.2,0,0,1), transform .26s cubic-bezier(0.2,0,0,1)", opacity: typing ? 1 : 0, transform: typing ? "scale(1)" : "scale(.4)" }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20V5" />
                <path d="M6 11 12 5 18 11" />
              </svg>
            </span>
          </button>
        </div>
      )}

      {/* bottom bar — [name ↗] and, while thinking, a stop button */}
      {showBar && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px 6px", animation: "vc-rise .28s cubic-bezier(0.22,1,0.36,1)" }}>
          <button
            type="button"
            onClick={openFile}
            title="Open in editor"
            className="vc-press"
            style={{ display: "inline-flex", alignItems: "center", gap: 2, height: 26, flex: "none", background: pal.chip, border: "none", borderRadius: 8, padding: "0 8px 0 7px", cursor: "pointer", color: pal.fg, font, fontSize: 12, fontWeight: 500 }}
          >
            {/* code-file icon — </> so it reads clearly as a file that opens */}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", opacity: 0.7, marginRight: 1 }}>
              <path d="M8.5 8 5 12l3.5 4" />
              <path d="M15.5 8 19 12l-3.5 4" />
              <path d="M13.5 6.5 10.5 17.5" />
            </svg>
            {panel.name}
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
              <path d="M7 17 17 7" />
              <path d="M8 7h9v9" />
            </svg>
          </button>
          <span style={{ flex: 1 }} />
          {busy && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              title="Stop"
              className="vc-press"
              style={{ width: 26, height: 26, borderRadius: "50%", border: "none", flex: "none", background: pal.chip, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, animation: "vc-pop .2s cubic-bezier(0.22,1,0.36,1)" }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 2, background: pal.fg, display: "inline-block" }} />
            </button>
          )}
        </div>
      )}
      </div>
    </>
  );
}

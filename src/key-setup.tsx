// First-run key setup. GET /__key (the cursorAgent middleware) reports —
// while no API key can be found — that the overlay should offer this modal;
// pasting a key POSTs it back, and the middleware writes it into the repo's
// .dev.vars (local-only, gitignored — never sent anywhere else). Freely
// dismissable: manual setup (env var / editing the file) always works, and a
// dismissal is remembered server-side (so the full reloads Vite fires around
// a restart can't eat it) until the dev server restarts.

import { useCallback, useEffect, useRef, useState } from "react";
import { FONT, MONO, isPageDark, palette } from "./theme";

let keyChecked = false; // one status check per page load (survives StrictMode remounts)

export function KeySetup() {
  const [info, setInfo] = useState<{ envName: string; file: string; dark: boolean } | null>(null);
  const [key, setKey] = useState("");
  const [phase, setPhase] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (keyChecked) return;
    keyChecked = true;
    (async () => {
      try {
        const r = await fetch("/__key");
        // A stamping-only setup has no agent middleware — Vite's SPA fallback
        // answers with HTML. Only trust a JSON reply.
        if (!r.ok || !r.headers.get("content-type")?.includes("json")) return;
        const d = (await r.json()) as { show?: boolean; envName?: string; file?: string };
        if (d.show && d.envName && d.file) setInfo({ envName: d.envName, file: d.file, dark: isPageDark() });
      } catch {
        /* dev server gone / no middleware — stay quiet */
      }
    })();
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // `notify` = the user waved the modal off — remember that server-side so it
  // stays gone across reloads until the dev server restarts. The post-save
  // auto-close passes false (the key being set already keeps it away).
  const dismiss = useCallback((notify = true) => {
    if (notify) void fetch("/__key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dismissed: true }) }).catch(() => {});
    setClosing(true);
    timers.current.push(window.setTimeout(() => setInfo(null), 200));
  }, []);

  // Esc dismisses — capture phase so the page underneath never sees it.
  useEffect(() => {
    if (!info) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      dismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [info, dismiss]);

  async function submit() {
    const k = key.trim();
    if (!k || phase === "busy" || phase === "saved") return;
    setPhase("busy");
    setError("");
    try {
      const r = await fetch("/__key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: k }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (d.ok) {
        setPhase("saved");
        timers.current.push(window.setTimeout(() => dismiss(false), 1400));
      } else {
        setPhase("error");
        setError(d.error ?? "Couldn't save the key.");
      }
    } catch {
      setPhase("error");
      setError("Couldn't save the key — is the dev server still running?");
    }
  }

  if (!info) return null;
  const pal = palette(info.dark);
  const saved = phase === "saved";
  const code = { font: `11.5px ${MONO}`, background: pal.chip, color: pal.fg, padding: "1px 5px", borderRadius: 5 } as const;

  return (
    <div
      data-vc-panel
      onClick={(e) => e.target === e.currentTarget && dismiss()}
      style={{ position: "fixed", inset: 0, zIndex: 3, pointerEvents: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)", opacity: closing ? 0 : 1, transition: "opacity .2s cubic-bezier(0.22,1,0.36,1)", animation: "vc-ring .3s cubic-bezier(0.22,1,0.36,1)" }}
    >
      <div
        style={{ width: 400, maxWidth: "calc(100vw - 32px)", boxSizing: "border-box", background: pal.bg, color: pal.fg, border: `1px solid ${pal.line}`, borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.22)", font: FONT, padding: 20, transform: closing ? "translateY(-6px)" : "none", filter: closing ? "blur(3px)" : "none", transition: "transform .2s cubic-bezier(0.22,1,0.36,1), filter .2s cubic-bezier(0.22,1,0.36,1)", animation: "vc-in .3s cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Add your Cursor API key</div>
        <div style={{ color: pal.sub, fontSize: 12.5, lineHeight: 1.55, marginBottom: 14 }}>
          {"Editing components from the browser runs a local Cursor agent, which needs a "}
          <code style={code}>{info.envName}</code>
          {". Paste one below — it's only written to "}
          <code style={code}>{info.file}</code>
          {" in your repo (gitignored), never committed or sent anywhere."}
        </div>
        <input
          type="password"
          autoFocus
          value={key}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setKey(e.target.value);
            if (phase === "error") {
              setPhase("idle");
              setError("");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={info.envName}
          style={{ width: "100%", boxSizing: "border-box", background: pal.chip, color: pal.fg, border: `1px solid ${pal.line}`, borderRadius: 10, padding: "9px 12px", outline: "none", font: `12.5px ${MONO}` }}
        />
        {phase === "error" && (
          <div style={{ color: "#e5533c", fontSize: 12, margin: "6px 2px 0", lineHeight: 1.4, animation: "vc-rise .28s cubic-bezier(0.22,1,0.36,1)" }}>{error}</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={() => dismiss()}
            className="vc-press"
            style={{ background: "none", border: "none", padding: "6px 4px", color: pal.sub, font: FONT, fontSize: 12.5, cursor: "pointer" }}
          >
            {"I'll add it myself"}
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={submit}
            disabled={!key.trim() || phase === "busy" || saved}
            className="vc-press"
            style={{ background: saved ? "#22a565" : pal.fg, color: saved ? "#ffffff" : pal.bg, border: "none", borderRadius: 10, padding: "7px 14px", font: FONT, fontSize: 12.5, fontWeight: 500, cursor: key.trim() && phase === "idle" ? "pointer" : "default", opacity: !key.trim() && !saved ? 0.5 : 1, transition: "background-color .25s cubic-bezier(0.22,1,0.36,1), opacity .2s cubic-bezier(0.22,1,0.36,1)" }}
          >
            {saved ? `Saved to ${info.file} ✓` : phase === "busy" ? "Saving…" : "Save locally"}
          </button>
        </div>
        <div style={{ color: pal.sub, fontSize: 11.5, lineHeight: 1.5, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${pal.line}` }}>
          {"Prefer manual? Set "}
          <code style={code}>{info.envName}</code>
          {" in your shell or "}
          <code style={code}>{info.file}</code>
          {" — this prompt won't show again until the dev server restarts."}
        </div>
      </div>
    </div>
  );
}

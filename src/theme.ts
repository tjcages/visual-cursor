// Shared visual vocabulary for every surface the overlay draws (the hover
// ring, composer panels, minimized pills, the key-setup modal): one palette
// keyed off whether the PAGE is in dark mode, plus the two font stacks.

export const palette = (dk: boolean) =>
  dk
    ? { bg: "#1a1a1a", fg: "#ededed", sub: "#8c8c8c", line: "#2e2e2e", chip: "#2a2a2a" }
    : { bg: "#ffffff", fg: "#1a1a1a", sub: "#8c8c8c", line: "#e6e6e6", chip: "#f0f0f0" };

export const FONT = "13px ui-sans-serif, system-ui, sans-serif";
export const MONO = "ui-monospace, SFMono-Regular, monospace";

// Lightness (0..1) + alpha of a CSS color string. Handles oklch (Tailwind v4's
// default — its first value already IS lightness), rgb/rgba, and hsl; returns
// null for a color we can't read (e.g. a fully transparent background).
function readColor(bg: string): { l: number; a: number } | null {
  const num = (s: string) => (s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s));
  const ok = bg.match(/oklch\(\s*([\d.]+%?)\s+[\d.]+\s+[\d.]+(?:\s*\/\s*([\d.]+%?))?/i);
  if (ok) return { l: num(ok[1]), a: ok[2] ? num(ok[2]) : 1 };
  const hsl = bg.match(/hsla?\(\s*[\d.]+(?:deg)?[\s,]+[\d.]+%?[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?/i);
  if (hsl) return { l: num(hsl[1]), a: hsl[2] ? num(hsl[2]) : 1 };
  const m = bg.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    const [r, g, b] = m.map(Number);
    return { l: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, a: m.length >= 4 ? Number(m[3]) : 1 };
  }
  return null;
}

// Is the WHOLE PAGE in dark mode? Judged globally (the theme class / color-scheme
// on <html>, or the page's own background) — NOT the local surface, so a component
// that happens to sit on a dark card doesn't force the panel dark.
export function isPageDark(): boolean {
  try {
    const html = document.documentElement;
    if (html.classList.contains("dark") || document.body?.classList.contains("dark")) return true;
    for (const node of [document.body, html]) {
      const c = node && readColor(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.2) return c.l < 0.5;
    }
    const cs = getComputedStyle(html).colorScheme;
    if (/dark/.test(cs) && !/light/.test(cs)) return true;
  } catch {
    /* ignore */
  }
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

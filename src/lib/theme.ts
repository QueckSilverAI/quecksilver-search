import { useCallback, useEffect, useState } from "react";

// ~30 accent swatches across full hues, mid-tones and neutrals — applied via
// a single CSS custom property (--brand). Separate from light/dark mode
// below (that's a real theme switch via Tailwind's .dark class, this is
// just the accent color, same distinction QAI's Settings makes).
export const THEME_COLORS = [
  "#2d6cd2", // QueckSilver blue (default)
  "#1d4ed8",
  "#0ea5e9",
  "#06b6d4",
  "#0d9488",
  "#16a34a",
  "#65a30d",
  "#84cc16",
  "#eab308",
  "#f59e0b",
  "#f97316",
  "#ea580c",
  "#dc2626",
  "#e11d48",
  "#db2777",
  "#ec4899",
  "#f472b6",
  "#d946ef",
  "#a855f7",
  "#8b5cf6",
  "#7c3aed",
  "#6366f1",
  "#7dd3fc", // light blue
  "#f9a8d4", // light pink
  "#fde047", // light yellow
  "#a7f3d0", // light mint
  "#c4b5fd", // light violet
  "#92400e", // brown
  "#57534e", // warm grey / brown-grey
  "#18181b", // black
  "#71717a", // grey
  "#0f766e", // deep teal
] as const;

const ACCENT_KEY = "qs-theme-color";
const DEFAULT_COLOR = THEME_COLORS[0];

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Hex form of the tab-strip tint, for the native titleBarOverlay (Windows) —
// that API needs a real hex color, not a CSS hsl() string.
export function chromeStripHex(hex: string): string {
  const [h, s] = hexToHsl(hex);
  return hslToHex(h, Math.min(s, 55), 92);
}

// Chrome background tints derived from the chosen accent — the tab strip,
// toolbar/url-bar backgrounds and card border shift from neutral grey
// toward the accent hue, at roughly the same lightness the greys used to
// sit at (so contrast/legibility stays put, only the hue changes).
// Dark-mode-aware: light mode tints stay near-white, dark mode tints stay
// genuinely dark — this used to always compute light values regardless of
// .dark being active, which is why the tab strip/address bar stayed light
// even in dark mode while everything else correctly went dark.
export function applyChromeTints(hex: string) {
  const [h, s] = hexToHsl(hex);
  const sat = Math.min(s, 55); // keep tints subtle even for very saturated accents
  const isDark = document.documentElement.classList.contains("dark");
  const root = document.documentElement.style;
  if (isDark) {
    root.setProperty("--chrome-strip", `hsl(${h} ${Math.min(sat, 25)}% 16%)`);
    root.setProperty("--chrome-field", `hsl(${h} ${Math.min(sat, 20)}% 22%)`);
    root.setProperty("--chrome-border", `hsl(${h} ${Math.min(sat, 20)}% 30%)`);
  } else {
    root.setProperty("--chrome-strip", `hsl(${h} ${sat}% 92%)`);
    root.setProperty("--chrome-field", `hsl(${h} ${Math.min(sat, 35)}% 95%)`);
    root.setProperty("--chrome-border", `hsl(${h} ${Math.min(sat, 30)}% 88%)`);
  }
}

export function useAccentColor() {
  const [color, setColorState] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_COLOR;
    return window.localStorage.getItem(ACCENT_KEY) || DEFAULT_COLOR;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--brand", color);
    applyChromeTints(color);
  }, [color]);

  const setColor = useCallback((next: string) => {
    setColorState(next);
    window.localStorage.setItem(ACCENT_KEY, next);
  }, []);

  return { color, setColor };
}

// Light/dark mode — toggles Tailwind's .dark class on <html>, which the
// existing CSS variables in styles.css already have values for.
export type ColorScheme = "light" | "dark" | "system";
const SCHEME_KEY = "qs-color-scheme";

function resolveIsDark(scheme: ColorScheme): boolean {
  if (scheme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
  return scheme === "dark";
}

function applyScheme(scheme: ColorScheme) {
  document.documentElement.classList.toggle("dark", resolveIsDark(scheme));
  // Re-derive the tab strip/address bar tints for the new light/dark
  // state — applyChromeTints reads .dark off the root itself, so this
  // just needs to fire again after that class actually changes above.
  applyChromeTints(window.localStorage.getItem(ACCENT_KEY) || DEFAULT_COLOR);
}

export function useColorScheme() {
  const [scheme, setSchemeState] = useState<ColorScheme>(() => {
    if (typeof window === "undefined") return "system";
    return (window.localStorage.getItem(SCHEME_KEY) as ColorScheme) || "system";
  });

  useEffect(() => {
    applyScheme(scheme);
    if (scheme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyScheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [scheme]);

  const setScheme = useCallback((next: ColorScheme) => {
    setSchemeState(next);
    window.localStorage.setItem(SCHEME_KEY, next);
  }, []);

  return { scheme, setScheme };
}

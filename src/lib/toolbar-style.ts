import { useCallback, useEffect, useState } from "react";

// Every option the person can pick for the Edit/Settings/Downloads/Split
// toolbar cluster — picked from several rounds of visual exploration (see
// Settings → Theme → Toolbar style for the live picker).
export type ToolbarStyleId =
  | "underline-slide"
  | "plain"
  | "segmented-pill"
  | "tinted-circles"
  | "labeled-card"
  | "floating-island"
  | "sliding-highlight"
  | "gradient-strip"
  | "whitespace-groups"
  | "elevated-chips"
  | "inline-chips"
  | "underline"
  | "click-pulse"
  | "radial-fan"
  | "progressive-dots"
  | "sliding-drawer"
  | "seamless-pill";

export const TOOLBAR_STYLES: { id: ToolbarStyleId; label: string }[] = [
  { id: "underline-slide", label: "Default" },
  { id: "seamless-pill", label: "Seamless pill" },
  { id: "plain", label: "Plain" },
  { id: "segmented-pill", label: "Segmented pill" },
  { id: "tinted-circles", label: "Tinted circles" },
  { id: "labeled-card", label: "Labeled card" },
  { id: "floating-island", label: "Floating island" },
  { id: "sliding-highlight", label: "Sliding highlight" },
  { id: "gradient-strip", label: "Gradient strip" },
  { id: "whitespace-groups", label: "Whitespace groups" },
  { id: "elevated-chips", label: "Elevated chips" },
  { id: "inline-chips", label: "Text chips" },
  { id: "underline", label: "Underline on hover" },
  { id: "click-pulse", label: "Click pulse" },
  { id: "radial-fan", label: "Radial fan menu" },
  { id: "progressive-dots", label: "Dots that grow on hover" },
  { id: "sliding-drawer", label: "Sliding drawer" },
];

const DEFAULT_STYLE: ToolbarStyleId = "underline-slide";

function isToolbarStyleId(value: string): value is ToolbarStyleId {
  return TOOLBAR_STYLES.some((s) => s.id === value);
}

// Backed by the main process (electron/toolbar-style-store.ts), NOT
// localStorage — this used to be a plain localStorage read/write, but the
// chrome UI's window loads from a fresh http://127.0.0.1:<random port>
// origin every time the app starts (see ensureProductionServer in
// electron/main.ts), so a choice saved to that origin's localStorage was
// unreachable — and looked "reset" — the next time the app launched.
// Every other setting that's meant to survive a restart already goes
// through the main process for exactly this reason (see
// src/lib/settings-store.ts's useSearchEngine) — this brings toolbar
// style in line.
//
// getToolbarStyle() below still needs to be readable synchronously by any
// new useToolbarStyle() instance that mounts before its own IPC round
// trip resolves — so this keeps a plain in-memory mirror, seeded by one
// async IPC fetch on module load and kept current for the lifetime of
// this window by a push event from main whenever ANY window changes it.
let cachedStyle: ToolbarStyleId = DEFAULT_STYLE;
const listeners = new Set<(style: ToolbarStyleId) => void>();

function setCachedStyle(style: ToolbarStyleId) {
  cachedStyle = style;
  listeners.forEach((l) => l(style));
}

if (typeof window !== "undefined" && window.browserAPI) {
  window.browserAPI.toolbarStyle.get().then((s) => {
    if (isToolbarStyleId(s)) setCachedStyle(s);
  });
  window.browserAPI.toolbarStyle.onChanged((s) => {
    if (isToolbarStyleId(s)) setCachedStyle(s);
  });
}

export function getToolbarStyle(): ToolbarStyleId {
  return cachedStyle;
}

export function useToolbarStyle() {
  const [style, setStyleState] = useState<ToolbarStyleId>(cachedStyle);

  useEffect(() => {
    listeners.add(setStyleState);
    return () => {
      listeners.delete(setStyleState);
    };
  }, []);

  const setStyle = useCallback((next: ToolbarStyleId) => {
    setCachedStyle(next); // optimistic — feels instant, matches every other setting in this app
    window.browserAPI?.toolbarStyle.set(next);
  }, []);

  return { style, setStyle };
}

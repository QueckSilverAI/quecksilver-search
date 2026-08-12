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
  | "sliding-drawer";

export const TOOLBAR_STYLES: { id: ToolbarStyleId; label: string }[] = [
  { id: "underline-slide", label: "Default" },
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

const KEY = "qs-toolbar-style";
const DEFAULT_STYLE: ToolbarStyleId = "underline-slide";

// Settings (where the picker lives) and the toolbar itself (routes/index.tsx)
// are separate component instances, each with their own useToolbarStyle()
// call — a plain useState+localStorage pair wouldn't let one instance's
// change reach the other without a full reload. This tiny subscriber list
// is what makes picking a style in Settings show up on the real toolbar
// immediately.
const listeners = new Set<(style: ToolbarStyleId) => void>();

export function useToolbarStyle() {
  const [style, setStyleState] = useState<ToolbarStyleId>(() => {
    if (typeof window === "undefined") return DEFAULT_STYLE;
    const raw = window.localStorage.getItem(KEY) as ToolbarStyleId | null;
    return raw && TOOLBAR_STYLES.some((s) => s.id === raw) ? raw : DEFAULT_STYLE;
  });

  useEffect(() => {
    listeners.add(setStyleState);
    return () => {
      listeners.delete(setStyleState);
    };
  }, []);

  const setStyle = useCallback((next: ToolbarStyleId) => {
    window.localStorage.setItem(KEY, next);
    for (const l of listeners) l(next);
  }, []);

  return { style, setStyle };
}

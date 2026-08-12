import { useEffect, useRef, useState } from "react";

// Own table, independent from the "Page zoom" setting (useZoomLevel in
// settings-store.ts) — deliberately NOT shared. They were briefly merged
// into one value, but that meant Ctrl+wheel on Start/Settings and the
// number in Settings fought over the same state and stepped on each
// other. Separate again: the setting controls the default zoom for new
// tabs (and, on Settings' own page, an explicit number to type in);
// Ctrl+wheel/pinch here is its own transient, in-only zoom for whichever
// content area it's attached to, reset on next launch.
const ZOOM_LEVELS = [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

function stepZoom(current: number, direction: "in" | "out"): number {
  let idx = 0;
  let closest = Infinity;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    const level = ZOOM_LEVELS[i]!;
    const diff = Math.abs(level - current);
    if (diff < closest) {
      closest = diff;
      idx = i;
    }
  }
  if (direction === "in" && idx < ZOOM_LEVELS.length - 1) idx++;
  else if (direction === "out" && idx > 0) idx--;
  return ZOOM_LEVELS[idx]!;
}

// Scoped Ctrl+wheel/pinch zoom for a single content container — used to
// zoom Start/Settings without touching the header/tab strip around them
// (see ZoomedContent.tsx). Real browsed pages don't need this: they're a
// separate WebContentsView, so Electron's native per-tab zoom (see
// tab-manager.ts) only ever affects that page's own content, never our
// chrome UI, and needs no JS-side handling at all.
//
// Deliberately NOT using Electron's native zoom here — Start/Settings share
// the SAME webContents as the header, and native zoom has no way to scope
// itself to a sub-region of a page, so main.ts leaves it off entirely for
// the main window. This hook does the whole thing in plain CSS zoom
// instead, driven by a manually-attached (non-passive) wheel listener —
// React's own onWheel prop is passive by default, which would silently
// swallow preventDefault() and let the page try to scroll instead of zoom.
export function usePageZoom<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [factor, setFactor] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setFactor((current) => stepZoom(current, e.deltaY < 0 ? "in" : "out"));
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return { ref, factor };
}

import { useEffect, useRef, useState } from "react";
import { stepZoom, ZOOM_LEVELS_NO_SHRINK } from "../../shared/zoom-levels";

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
//
// Steps through ../../shared/zoom-levels.ts's ZOOM_LEVELS_NO_SHRINK — same
// notches/spacing as real tabs' native zoom table, but floored at 1 (never
// below 100%): Start/Settings can only zoom IN from their normal size, not
// shrink below it. Scrolling back down still works to undo a zoom-in (1 is
// the floor, not a one-way ratchet), it just can never go past 100%.
export function usePageZoom<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [factor, setFactor] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setFactor((current) => stepZoom(current, e.deltaY < 0 ? "in" : "out", ZOOM_LEVELS_NO_SHRINK));
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return { ref, factor };
}

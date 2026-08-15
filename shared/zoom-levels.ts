// Discrete zoom levels, same table Chrome itself steps through on
// Ctrl+wheel/pinch — using fixed levels (not a flat +/- delta) is what
// makes each notch feel like a deliberate, evenly-spaced step instead of
// drifting to odd percentages the longer you scroll.
//
// Single source of truth, imported from BOTH sides of the process
// boundary: electron/zoom.ts (main process — native per-tab zoom on real
// browsed pages) and src/hooks/use-page-zoom.ts (renderer — Start/
// Settings' own Ctrl+wheel/pinch handling). One table instead of two
// silently drifting apart.
export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

// Same notches as ZOOM_LEVELS, but never below 100% — Start/Settings'
// interactive zoom is deliberately zoom-IN-only (scrolling back down
// toward 1 to undo a zoom-in still works, since 1 is the floor here, not
// the ceiling; you just can never shrink the page below its normal size).
// Real browsed tabs are NOT limited to this — they use the full
// ZOOM_LEVELS table above via electron/zoom.ts, unchanged.
export const ZOOM_LEVELS_NO_SHRINK = ZOOM_LEVELS.filter((l) => l >= 1);

export function stepZoom(current: number, direction: "in" | "out", levels: readonly number[] = ZOOM_LEVELS): number {
  let idx = 0;
  let closest = Infinity;
  for (let i = 0; i < levels.length; i++) {
    const diff = Math.abs(levels[i]! - current);
    if (diff < closest) {
      closest = diff;
      idx = i;
    }
  }
  if (direction === "in" && idx < levels.length - 1) idx++;
  else if (direction === "out" && idx > 0) idx--;
  return levels[idx]!;
}

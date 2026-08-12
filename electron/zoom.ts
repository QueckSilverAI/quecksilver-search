// Discrete zoom levels, same table Chrome itself steps through on
// Ctrl+wheel/pinch — using fixed levels (not a flat +/- delta) is what
// makes each notch feel like a deliberate, evenly-spaced step instead of
// drifting to odd percentages the longer you scroll.
//
// Shared between tab-manager.ts (per-tab zoom on real browsed pages) and
// main.ts (the main window's own webContents, used for Start/Settings —
// see main.ts's zoom-changed listener) so both step through the exact same
// table instead of two copies drifting apart.
export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export function stepZoom(current: number, direction: "in" | "out"): number {
  let idx = 0;
  let closest = Infinity;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    const diff = Math.abs(ZOOM_LEVELS[i] - current);
    if (diff < closest) {
      closest = diff;
      idx = i;
    }
  }
  if (direction === "in" && idx < ZOOM_LEVELS.length - 1) idx++;
  else if (direction === "out" && idx > 0) idx--;
  return ZOOM_LEVELS[idx];
}

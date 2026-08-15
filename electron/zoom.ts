// Re-exports the single shared zoom table (see ../shared/zoom-levels.ts)
// so every existing import of "./zoom" in this codebase (tab-manager.ts's
// native per-tab zoom, main.ts) keeps working unchanged, while the actual
// levels/stepping logic lives in one place shared with the renderer's
// Start/Settings zoom (src/hooks/use-page-zoom.ts) — no more two copies
// of the same table drifting apart.
export { ZOOM_LEVELS, stepZoom } from "../shared/zoom-levels";

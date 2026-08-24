import { usePageZoom } from "@/hooks/use-page-zoom";
import { useZoomLevel } from "@/lib/settings-store";

// Wraps exactly the Home/Settings content area — Ctrl+wheel/pinch zoom
// applies only inside this box, never to the header or tab strip rendered
// outside it. One instance per place it's used (see routes/index.tsx),
// each with its own independent interactive zoom state — mirrors how each
// browsed tab also zooms independently.
//
// Combines two SEPARATE, independently-stored zoom values rather than one:
// usePageZoom's own transient, in-only Ctrl+wheel/pinch factor, and the
// persisted "Default page zoom" setting (useZoomLevel — also what a new
// browsed tab starts at). Multiplying them together means both controls
// actually do something visible on their own without fighting over the
// same state the way an earlier version did: dragging the Settings number
// up/down zooms this content immediately, and Ctrl+wheel still zooms
// further from wherever that baseline currently sits.
//
// overflow is forced here via inline style (not left to the caller's
// className) specifically so it can't lose to an `overflow-hidden` some
// caller passes for unrelated reasons — inline style always wins over a
// class regardless of Tailwind's generated CSS order. Without this, zoomed
// content that no longer fits just got clipped with no way to reach the
// rest of it: real browser zoom (on an actual webpage, or Ctrl+wheel on a
// real browsed tab here) always leaves the page scrollable in BOTH
// directions at whatever zoom level you land on — this box needs to behave
// the same way. Both axes are made scrollable, not just vertical — Home's
// logo/wordmark row isn't a responsive layout that reflows at different
// widths the way a real page like YouTube's grid does, so at high enough
// zoom it genuinely does need to be reached by scrolling right, exactly
// like a real page with non-responsive fixed-width content would.
export function ZoomedContent({ className, children }: { className?: string; children: React.ReactNode }) {
  const { ref, factor } = usePageZoom<HTMLDivElement>();
  const { level } = useZoomLevel();
  return (
    <div
      ref={ref}
      className={`custom-scrollbar ${className ?? ""}`}
      style={{ zoom: factor * (level / 100), overflow: "auto" }}
    >
      {children}
    </div>
  );
}

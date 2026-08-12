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
export function ZoomedContent({ className, children }: { className?: string; children: React.ReactNode }) {
  const { ref, factor } = usePageZoom<HTMLDivElement>();
  const { level } = useZoomLevel();
  return (
    <div ref={ref} className={className} style={{ zoom: factor * (level / 100) }}>
      {children}
    </div>
  );
}

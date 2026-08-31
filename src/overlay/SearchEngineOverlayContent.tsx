// Content-only counterpart of the URL bar's search-engine pill (see
// src/components/SearchEngineChooser.tsx's "inline" variant), hosted in
// the native overlay window (electron/overlay-window.ts) instead of as a
// plain absolutely-positioned DOM panel — same reasoning as every other
// dropdown that migrated here: a real website tab's native
// WebContentsView always paints above the chrome UI regardless of CSS
// z-index, which was hiding the old local panel whenever it opened over
// an actual page instead of the Start page.
import { EngineIcon } from "@/components/SearchEngineChooser";
import { SEARCH_ENGINES } from "../../shared/search-engines";
import { Check } from "lucide-react";
import type { SearchEngineOverlayAction, SearchEngineOverlayPayload } from "@/overlay/types";

export function SearchEngineOverlayContent({
  payload,
  onAction,
}: {
  payload: SearchEngineOverlayPayload;
  onAction: (action: SearchEngineOverlayAction) => void;
}) {
  const { current } = payload;

  return (
    // No box-shadow here on purpose — same reasoning as
    // TabsMenuContent.tsx/FolderContentsContent.tsx's popovers: the
    // native overlay window is sized exactly to this content's measured
    // bounding box, so a shadow paints outside that box and gets
    // hard-clipped right at the window edge instead of fading — that's
    // what produced the shadow-artifact at the bottom corners. The
    // border alone is enough.
    <div className="w-52 overflow-hidden rounded-xl border border-border bg-popover">
      <div className="border-b border-border py-2 pl-3 text-[12px] font-semibold text-muted-foreground">Choose Search Engine</div>
      <div className="custom-scrollbar max-h-64 overflow-y-auto py-1 px-1">
        {SEARCH_ENGINES.map((e) => (
          <button
            key={e.id}
            onClick={() => onAction({ type: "select", id: e.id })}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium hover:bg-muted ${
              e.id === current ? "text-[var(--brand)]" : "text-foreground"
            }`}
          >
            <EngineIcon engine={e} className="h-4 w-4 shrink-0 rounded-sm" innerClassName="h-full w-full" />
            <span className="truncate">{e.label}</span>
            {e.id === current && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}

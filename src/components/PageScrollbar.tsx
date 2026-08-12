import type { RefObject } from "react";
import { useCustomScrollbar } from "@/hooks/use-custom-scrollbar";

// Our own scrollbar for scroll containers we render ourselves (Start,
// Settings) — same track/thumb/arrow design as chathistory-scrollbar.html
// and electron/tab-preload.ts's widget for real browsed pages. Sits as an
// absolute overlay on the right edge of `scrollRef`'s element, so the only
// requirement on the caller is that the container is `relative` (or another
// positioning context) and already has its native scrollbar hidden — both
// true globally already (see styles.css `* { scrollbar-width: none }`).
export function PageScrollbar({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const { trackRef, visible, thumbHeight, thumbTop, atTop, atBottom, dragging, scrollByStep, onThumbMouseDown } =
    useCustomScrollbar(scrollRef);

  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-50 flex w-3.5 flex-col select-none">
      <button
        type="button"
        aria-label="Scroll up"
        disabled={atTop}
        onMouseDown={(e) => {
          e.preventDefault();
          scrollByStep(-1);
        }}
        className="pointer-events-auto flex h-[22px] w-full shrink-0 items-center justify-center rounded-t-md border-none bg-transparent p-0 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 disabled:cursor-default disabled:opacity-25"
      >
        <svg width="12" height="8" viewBox="0 0 12 8" fill="currentColor">
          <path d="M6 1.5C6.3 1.5 6.5 1.6 6.7 1.8L10.5 6.2C10.9 6.7 10.6 7.5 9.9 7.5H2.1C1.4 7.5 1.1 6.7 1.5 6.2L5.3 1.8C5.5 1.6 5.7 1.5 6 1.5Z" />
        </svg>
      </button>

      <div ref={trackRef} className="relative flex-1">
        <div
          onMouseDown={onThumbMouseDown}
          className={`pointer-events-auto absolute left-[3px] right-[3px] cursor-grab rounded-full transition-colors ${
            dragging ? "cursor-grabbing bg-muted-foreground/55" : "bg-muted-foreground/35 hover:bg-muted-foreground/55"
          }`}
          style={{ height: thumbHeight, top: thumbTop }}
        />
      </div>

      <button
        type="button"
        aria-label="Scroll down"
        disabled={atBottom}
        onMouseDown={(e) => {
          e.preventDefault();
          scrollByStep(1);
        }}
        className="pointer-events-auto flex h-[22px] w-full shrink-0 items-center justify-center rounded-b-md border-none bg-transparent p-0 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 disabled:cursor-default disabled:opacity-25"
      >
        <svg width="12" height="8" viewBox="0 0 12 8" fill="currentColor">
          <path d="M6 6.5C5.7 6.5 5.5 6.4 5.3 6.2L1.5 1.8C1.1 1.3 1.4 0.5 2.1 0.5H9.9C10.6 0.5 10.9 1.3 10.5 1.8L6.7 6.2C6.5 6.4 6.3 6.5 6 6.5Z" />
        </svg>
      </button>
    </div>
  );
}

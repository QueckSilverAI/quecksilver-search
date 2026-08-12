import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HeaderFavorite } from "@/hooks/use-browser-api";

type Props = {
  favorites: HeaderFavorite[];
  onOpen: (url: string) => void;
  onReorder: (dragId: string, dropId: string) => void;
  renderIcon: (f: HeaderFavorite) => React.ReactNode;
};

const ARROW_WIDTH = 28; // reserved space for a </> button when one is needed
const GAP = 6; // matches gap-1.5

// Paginates the favorites row instead of letting it overflow/scroll —
// measures each item's real rendered width (labels vary in length) via
// refs, then greedily fills each "page" with as many items as actually
// fit the available width, reserving room for arrows only when a page
// before/after actually exists.
export function HeaderFavoritesBar({ favorites, onOpen, onReorder, renderIcon }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [containerWidth, setContainerWidth] = useState(0);
  const [itemWidths, setItemWidths] = useState<Record<string, number>>({});
  const [page, setPage] = useState(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const report = () => setContainerWidth(el.clientWidth);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Re-measure actual item widths whenever the favorites list changes —
  // items are first rendered all-in-one-row (off the visible page) so
  // their natural widths are known before pages are computed.
  useLayoutEffect(() => {
    const widths: Record<string, number> = {};
    for (const f of favorites) {
      const el = itemRefs.current.get(f.id);
      if (el) widths[f.id] = el.getBoundingClientRect().width;
    }
    setItemWidths(widths);
  }, [favorites, containerWidth]);

  // Greedily fill pages using the measured widths.
  // Reserve room for both potential arrows up front — whether a page ends
  // up needing one depends on how many pages there are, which depends on
  // how much width is available, which would depend on whether a page
  // needs one... reserving space unconditionally avoids that circularity.
  // Also account for the container's own gap-1.5 landing on either side of
  // each slot (between left-slot↔first item, and last item↔right-slot) —
  // missing that was exactly why the right arrow was getting clipped: the
  // real content was ~12px wider than what was budgeted for it.
  const workingWidth = Math.max(0, containerWidth - ARROW_WIDTH * 2 - GAP * 2);

  const pages: HeaderFavorite[][] = [];
  {
    let current: HeaderFavorite[] = [];
    let used = 0;
    for (const f of favorites) {
      const w = itemWidths[f.id] ?? 100;
      const withGap = current.length > 0 ? w + GAP : w;
      if (used + withGap > workingWidth && current.length > 0) {
        pages.push(current);
        current = [f];
        used = w;
      } else {
        current.push(f);
        used += withGap;
      }
    }
    if (current.length > 0) pages.push(current);
  }

  const hasMultiplePages = pages.length > 1;
  const safePage = Math.min(page, Math.max(0, pages.length - 1));
  const visible = pages[safePage] ?? favorites;

  return (
    <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {/* Hidden measurement pass — every favorite rendered off-screen once
          so its natural width is known, independent of which page is
          currently showing. */}
      <div className="pointer-events-none absolute -left-[9999px] -top-[9999px] flex gap-1.5">
        {favorites.map((f) => (
          <button
            key={f.id}
            ref={(el) => {
              if (el) itemRefs.current.set(f.id, el);
              else itemRefs.current.delete(f.id);
            }}
            className={`flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] ${f.iconOnly ? "" : "max-w-[180px]"}`}
          >
            {renderIcon(f)}
            {!f.iconOnly && <span className="truncate">{f.label}</span>}
          </button>
        ))}
      </div>

      {/* Only actually rendered (and thus only actually taking up space)
          when that arrow is genuinely needed — on the first page there's
          no "previous", so nothing reserves room on the left and items
          start flush at the true left edge. */}
      {hasMultiplePages && safePage > 0 && (
        <button
          onClick={() => setPage((p) => p - 1)}
          aria-label="Previous favorites"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {visible.map((f) => (
        <div key={f.id} className="relative flex h-8 shrink-0 items-center">
          {dropTargetId === f.id && draggedId && draggedId !== f.id && (
            <span className="pointer-events-none absolute -left-[5px] top-0.5 bottom-0.5 w-[2px] rounded-full" style={{ background: "var(--brand)" }} />
          )}
          <button
            draggable
            onDragStart={(e) => {
              // The empty setData call is required, not optional — Chromium
              // doesn't reliably fire drop at all without SOME data actually
              // set here (learned this the hard way on the toolbar icons'
              // own drag-reorder first).
              e.dataTransfer.setData("text/plain", f.id);
              e.dataTransfer.effectAllowed = "move";
              setDraggedId(f.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedId && draggedId !== f.id) setDropTargetId(f.id);
            }}
            onDragLeave={() => setDropTargetId((v) => (v === f.id ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              if (draggedId && draggedId !== f.id) onReorder(draggedId, f.id);
              setDraggedId(null);
              setDropTargetId(null);
            }}
            onDragEnd={() => {
              setDraggedId(null);
              setDropTargetId(null);
            }}
            onClick={() => onOpen(f.url)}
            className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-foreground transition-colors hover:bg-foreground/5 ${f.iconOnly ? "" : "max-w-[180px]"} ${
              draggedId === f.id ? "opacity-40" : ""
            }`}
          >
            {renderIcon(f)}
            {!f.iconOnly && <span className="truncate">{f.label}</span>}
          </button>
        </div>
      ))}

      {hasMultiplePages && safePage < pages.length - 1 && (
        <button
          onClick={() => setPage((p) => p + 1)}
          aria-label="More favorites"
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

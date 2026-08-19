import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HeaderFavorite } from "@/hooks/use-browser-api";

type Props = {
  favorites: HeaderFavorite[];
  onOpen: (url: string) => void;
  onOpenFolder: (folder: HeaderFavorite, e: React.MouseEvent<HTMLButtonElement>) => void;
  onReorder: (dragId: string, dropId: string) => void;
  onAddToFolder: (dragId: string, folderId: string) => void;
  onRemoveFromFolder: (id: string) => void;
  onContextMenu: (f: HeaderFavorite, e: React.MouseEvent<HTMLButtonElement>) => void;
  renderIcon: (f: HeaderFavorite) => React.ReactNode;
};

// Custom MIME type FolderContentsContent.tsx's own drag items use — see
// its onDragStart for why this needs to be different from the plain
// "text/plain" this file's own internal reorder drags carry.
const FROM_FOLDER_MIME = "application/x-qs-favorite-from-folder";

const ARROW_WIDTH = 28; // reserved space for a </> button when one is needed
const GAP = 6; // matches gap-1.5

// Paginates the favorites row instead of letting it overflow/scroll —
// measures each item's real rendered width (labels vary in length) via
// refs, then greedily fills each "page" with as many items as actually
// fit the available width, reserving room for arrows only when a page
// before/after actually exists.
export function HeaderFavoritesBar({ favorites: allFavorites, onOpen, onOpenFolder, onReorder, onAddToFolder, onRemoveFromFolder, onContextMenu, renderIcon }: Props) {
  // The bar itself only ever shows top-level entries — anything with a
  // parentId lives inside a folder and is only ever shown in that
  // folder's own dropdown (see FolderContentsContent.tsx), never here
  // directly. Memoized (not a plain .filter() in the render body) — an
  // inline .filter() returns a NEW array reference every single render
  // regardless of whether allFavorites actually changed, and this array
  // feeds a useLayoutEffect below keyed on it: that effect would fire
  // every render, call setItemWidths, trigger a re-render, get a new
  // filtered array again, fire again... forever. Confirmed directly from
  // a "Maximum update depth exceeded" crash pointing right at that
  // effect. useMemo keyed on allFavorites itself is what actually breaks
  // the loop — same array in, same array out, so the effect only
  // re-fires when the REAL favorites data changes.
  const favorites = useMemo(() => allFavorites.filter((f) => !f.parentId), [allFavorites]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Throttles drag-triggered page changes (see the arrow buttons'
  // onDragOver below) — dragover fires continuously (many times a
  // second) the whole time the mouse sits over an element, so without
  // this a single hover would fire setPage() dozens of times in a row.
  const lastDragPageChangeAt = useRef(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [itemWidths, setItemWidths] = useState<Record<string, number>>({});
  const [page, setPage] = useState(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Bumped by every reset (event-driven or the timer backstop below) — a
  // late-firing timer from an OLDER drag can't incorrectly clear a NEWER
  // one's state that's already legitimately in progress by the time it
  // fires, since it only resets if the generation it captured is still
  // current.
  const dragGeneration = useRef(0);

  // A per-item onDragEnd alone isn't reliable once the auto-paginate-
  // during-drag feature (the arrow buttons' onDragOver above) is in play
  // — dragging near an arrow changes `page`, which can un-render the
  // dragged item's own button (it's no longer on the now-visible page),
  // and a "dragend" fired at that point has nowhere to land if its
  // origin element is already gone from the DOM. That left draggedId
  // stuck forever, showing SOME favorite permanently greyed out (opacity
  // -40) long after the drag actually ended. A window-level listener
  // doesn't care whether the originating element still exists — it
  // always fires when the OS-level drag session itself ends, so this
  // can never get stuck the way the per-item handler could.
  useEffect(() => {
    const reset = () => {
      dragGeneration.current++;
      setDraggedId(null);
      setDropTargetId(null);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);

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
    <div
      ref={containerRef}
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
      onDragOver={(e) => {
        // Only for a drop landing on EMPTY space in the bar (not on any
        // specific item — those handle it themselves below and stop the
        // event from bubbling up here). Pulls the favorite out of
        // whatever folder it came from without needing to land on a
        // particular item.
        if (e.dataTransfer.types.includes(FROM_FOLDER_MIME)) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(FROM_FOLDER_MIME)) return;
        e.preventDefault();
        const id = e.dataTransfer.getData(FROM_FOLDER_MIME);
        if (id) onRemoveFromFolder(id);
      }}
    >
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
          onDragOver={(e) => {
            // Dragging a favorite near this arrow flips to the previous
            // page WHILE still dragging, so a favorite from page 3 can
            // reach page 1's items to reorder/drop onto without first
            // manually clicking through — same idea as a file manager
            // auto-scrolling near an edge during drag.
            if (!draggedId) return;
            e.preventDefault();
            const now = Date.now();
            if (now - lastDragPageChangeAt.current > 500) {
              lastDragPageChangeAt.current = now;
              setPage((p) => Math.max(0, p - 1));
            }
          }}
          aria-label="Previous favorites"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {visible.map((f) => (
        <div key={f.id} className="relative flex h-8 shrink-0 items-center">
          {dropTargetId === f.id && draggedId && draggedId !== f.id && !f.isFolder && (
            <span className="pointer-events-none absolute -left-[5px] top-0.5 bottom-0.5 w-[2px] rounded-full" style={{ background: "var(--brand)" }} />
          )}
          {/* Ring instead of the reorder line when the drop target is a
              folder — signals "drop HERE to add to this folder" as
              visually distinct from "drop here to reorder". */}
          {dropTargetId === f.id && draggedId && draggedId !== f.id && f.isFolder && (
            <span className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-inset" style={{ ["--tw-ring-color" as string]: "var(--brand)" }} />
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
              // Backstop — see dragGeneration's doc comment above. 4s is
              // generous for any real drag (they're all sub-second), so
              // this never fires for a normal one; it only matters for
              // the rare case where NOTHING else ever reset the state.
              const gen = ++dragGeneration.current;
              setTimeout(() => {
                if (dragGeneration.current === gen) {
                  setDraggedId(null);
                  setDropTargetId(null);
                }
              }, 4000);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation(); // don't ALSO trigger the container's own onDragOver below
              if (draggedId && draggedId !== f.id) setDropTargetId(f.id);
            }}
            onDragLeave={() => setDropTargetId((v) => (v === f.id ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation(); // don't ALSO trigger the container's own onDrop below
              // A favorite being pulled OUT of a folder (see
              // FolderContentsContent.tsx's onDragStart) landing directly
              // on an item here — same as landing on empty bar space
              // (the container's own onDrop), just un-parent it; where it
              // was dropped doesn't otherwise matter.
              if (e.dataTransfer.types.includes(FROM_FOLDER_MIME)) {
                const id = e.dataTransfer.getData(FROM_FOLDER_MIME);
                if (id) onRemoveFromFolder(id);
                dragGeneration.current++;
                setDraggedId(null);
                setDropTargetId(null);
                return;
              }
              // Dropping directly ONTO a folder adds the dragged favorite
              // to it; dropping onto anything else just reorders — see
              // use-header-favorites.ts's addToFolder/reorder for how
              // folders actually get their contents (createFolder itself
              // is a separate, explicit "New folder" step in the
              // right-click menu, not something a drag can trigger).
              if (draggedId && draggedId !== f.id) {
                if (f.isFolder) onAddToFolder(draggedId, f.id);
                else onReorder(draggedId, f.id);
              }
              dragGeneration.current++;
              setDraggedId(null);
              setDropTargetId(null);
            }}
            onDragEnd={() => {
              dragGeneration.current++;
              setDraggedId(null);
              setDropTargetId(null);
            }}
            onClick={(e) => (f.isFolder ? onOpenFolder(f, e) : onOpen(f.url))}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(f, e);
            }}
            title={f.isFolder ? f.label : undefined}
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
          onDragOver={(e) => {
            if (!draggedId) return;
            e.preventDefault();
            const now = Date.now();
            if (now - lastDragPageChangeAt.current > 500) {
              lastDragPageChangeAt.current = now;
              setPage((p) => Math.min(pages.length - 1, p + 1));
            }
          }}
          aria-label="More favorites"
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

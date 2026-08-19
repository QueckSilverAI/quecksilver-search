// The dropdown a favorites-bar FOLDER opens when clicked (see
// HeaderFavoritesBar.tsx — folders render in the bar itself, this is what
// shows their contents). Right-click on an item shows an INLINE menu
// (rendered right here, absolutely positioned within this same window) —
// not a separate overlay kind, which would replace this one (there's only
// ever one overlay window, reused — see overlay-window.ts's class
// comment) and close the folder just from right-clicking something in it.
import { useEffect, useState } from "react";
import { Clipboard, Copy, ExternalLink, Eye, FolderMinus, Pencil, Scissors, SquareArrowOutUpRight, Trash2, UserRoundX } from "lucide-react";
import { FavIcon } from "@/components/FavIcon";
import type { FavoriteFolderOverlayAction, FavoriteFolderOverlayPayload } from "@/overlay/types";

type Item = FavoriteFolderOverlayPayload["items"][number];

function MenuItem({ icon: Icon, label, onClick }: { icon: React.FC<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted">
      <Icon className="h-[15px] w-[15px] shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function FolderContentsContent({
  payload,
  onAction,
  onNotify,
}: {
  payload: FavoriteFolderOverlayPayload;
  onAction: (action: FavoriteFolderOverlayAction) => void;
  onNotify: (action: FavoriteFolderOverlayAction) => void;
}) {
  // The item the inline menu is currently open for — null when it's
  // closed. Re-clicking elsewhere (the menu's own backdrop below) closes
  // it without needing to touch the overlay window itself at all.
  const [menuItem, setMenuItem] = useState<Item | null>(null);

  // The overlay window's own React content is never actually unmounted
  // just because the native window gets hidden (closed) and reshown
  // (reopened) — it's one reused window/page (see overlay-window.ts's
  // class comment), so this component's local state doesn't reset on
  // its own the way a person would expect just from closing a popup. A
  // person reported exactly that: right-click a favorite, close the
  // folder, reopen the SAME folder — the menu was still open. Chromium
  // does fire visibilitychange when a hidden BrowserWindow is shown
  // again, even without any navigation, so this is what actually resets
  // transient UI state like an open menu on every fresh reopen.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setMenuItem(null);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Every notify-based menu item closes the LOCAL inline menu after
  // acting (the overlay window itself stays open regardless — that's
  // the whole point of onNotify over onAction here).
  function pick(action: FavoriteFolderOverlayAction) {
    onNotify(action);
    setMenuItem(null);
  }

  return (
    <div
      className="relative w-64"
      // The window itself is sized (via ResizeObserver, see
      // overlay-window.ts's reportSize) to whatever this whole div
      // measures — but position:absolute children (the menu below)
      // don't contribute to that measurement at all, regardless of
      // anything else. Without an explicit min-height here while the
      // menu is open, the native window stayed sized to just the folder
      // LIST's own height, physically clipping the menu at the window's
      // real edge the moment it tried to extend past that — a person
      // reported exactly this ("popup only visible within the folder").
      // 500px comfortably fits the menu's full height (4 groups, up to
      // 3 items each, plus dividers) starting from its top-10 offset.
      style={menuItem ? { minHeight: 500 } : undefined}
    >
      {/* overflow-hidden + the rounding live on this INNER wrapper, not
          the outer one above — so the menu (a sibling of this, not a
          child) is never clipped by it either. */}
      <div className="overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground">
        <div className="px-3 pb-1.5 pt-3">
          <h2 className="truncate text-[13px] font-semibold text-foreground">{payload.label}</h2>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5 pt-0.5">
          {payload.items.length === 0 ? (
            <p className="px-2.5 py-4 text-center text-[13px] text-muted-foreground">Empty folder</p>
          ) : (
            payload.items.map((item) => (
              <button
                key={item.id}
                draggable
                onDragStart={(e) => {
                  // A DIFFERENT MIME type than HeaderFavoritesBar's own
                  // internal drag-reorder ("text/plain") — this one crosses
                  // from the folder's own overlay window INTO the main
                  // chrome window's favorites bar, a native OS-level HTML5
                  // drag session that Electron/Chromium does support across
                  // separate BrowserWindows. Deliberately distinct so
                  // HeaderFavoritesBar can tell "a favorite is being pulled
                  // out of a folder" apart from its own ordinary reorder
                  // drags without any ambiguity.
                  e.dataTransfer.setData("application/x-qs-favorite-from-folder", item.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onAction({ type: "open", url: item.url })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuItem(item);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
              >
                <FavIcon url={item.url} label={item.label} size="h-4 w-4" />
                <span className="truncate text-[13px] text-foreground">{item.label}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {menuItem && (
        <>
          {/* Full-window backdrop, not just a click-outside listener —
              simplest reliable way to close the inline menu on any click
              elsewhere within this same small window. Invisible
              (pointer-events only), sits behind the menu itself. */}
          <div className="fixed inset-0 z-10" onClick={() => setMenuItem(null)} />
          {/* No box-shadow here on purpose — same reasoning as
              ProfilePopupContent's root div and the standalone
              FavoriteContextMenuContent (this menu's non-inline sibling):
              the native overlay window is sized EXACTLY to its measured
              content's bounding box (see reportSize in
              overlay-window.ts), and this menu's own container (the
              `relative w-64` div above) is what gets measured — a
              box-shadow paints outside that box without affecting its
              measured size, so it doesn't get a soft fade, it gets a hard
              rectangular clip right at the window's edge (previously
              `shadow-2xl` here, unlike every other overlay menu, which is
              what produced the shadow-artifact people reported). */}
          <div className="absolute left-2 top-10 z-20 w-56 overflow-hidden rounded-2xl border border-border bg-white p-1.5">
            <div className="flex flex-col">
              <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => pick({ type: "openInNewTab", url: menuItem.url })} />
              <MenuItem icon={SquareArrowOutUpRight} label="Open in new window" onClick={() => pick({ type: "openInNewWindow", url: menuItem.url })} />
              <MenuItem icon={UserRoundX} label="Open in InPrivate window" onClick={() => pick({ type: "openInIncognitoWindow", url: menuItem.url })} />
            </div>
            <div className="mx-1 my-1 h-px bg-border" />
            <div className="flex flex-col">
              <MenuItem icon={Pencil} label="Edit" onClick={() => onAction({ type: "edit", id: menuItem.id })} />
              <MenuItem
                icon={Eye}
                label={menuItem.iconOnly ? "Show icon and name" : "Show icon only"}
                onClick={() => pick({ type: "toggleIconOnly", id: menuItem.id, iconOnly: !menuItem.iconOnly })}
              />
              <MenuItem icon={FolderMinus} label="Remove from folder" onClick={() => pick({ type: "removeFromFolder", id: menuItem.id })} />
            </div>
            <div className="mx-1 my-1 h-px bg-border" />
            <div className="flex flex-col">
              <MenuItem icon={Scissors} label="Cut" onClick={() => pick({ type: "cut", id: menuItem.id, url: menuItem.url })} />
              <MenuItem icon={Copy} label="Copy" onClick={() => pick({ type: "copy", url: menuItem.url })} />
              <MenuItem icon={Clipboard} label="Paste" onClick={() => setMenuItem(null)} />
            </div>
            <div className="mx-1 my-1 h-px bg-border" />
            <MenuItem icon={Trash2} label="Delete" onClick={() => pick({ type: "delete", id: menuItem.id })} />
          </div>
        </>
      )}
    </div>
  );
}

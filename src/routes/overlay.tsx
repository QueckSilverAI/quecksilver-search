import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useOverlayHost } from "@/hooks/use-overlay-host";
import { ProfilePopupContent } from "@/overlay/ProfilePopupContent";
import { ContextMenuContent } from "@/overlay/ContextMenuContent";
import { BookmarkDialogContent } from "@/overlay/BookmarkDialogContent";
import { GroupDialogContent } from "@/overlay/GroupDialogContent";
import { TabSearchContent } from "@/overlay/TabSearchContent";
import { DownloadsPopoverContent } from "@/overlay/DownloadsPopoverContent";
import { FavoriteContextMenuContent } from "@/overlay/FavoriteContextMenuContent";
import { FavoriteEditDialogContent } from "@/overlay/FavoriteEditDialogContent";
import { FolderContentsContent } from "@/overlay/FolderContentsContent";
import { NewFavoriteFolderDialogContent } from "@/overlay/NewFavoriteFolderDialogContent";
import { ControlCenterContent } from "@/overlay/ControlCenterContent";
import { TabPreviewContent } from "@/overlay/TabPreviewContent";
import type {
  BookmarkOverlayPayload,
  ContextMenuOverlayPayload,
  DownloadsOverlayPayload,
  FavoriteContextMenuOverlayPayload,
  FavoriteEditOverlayPayload,
  FavoriteFolderOverlayPayload,
  GroupDialogOverlayPayload,
  ProfileOverlayPayload,
  TabPreviewOverlayPayload,
  TabSearchOverlayPayload,
  TabsMenuOverlayPayload,
} from "@/overlay/types";

// The overlay window's entire renderer content. Deliberately NOT the full
// TanStack Router tree the main chrome UI uses (no header, no tab strip,
// no query client needed yet) — just enough to host whichever "kind" of
// overlay content is currently open. Still rendered inside the same
// __root.tsx shell (see routes/__root.tsx), so it gets the same <html>/
// <head>/appCss automatically — no separate HTML document to maintain.
export const Route = createFileRoute("/overlay")({
  // Same reasoning as routes/index.tsx's own ssr: false — this window is
  // exclusively Electron's own native overlay host, server rendering it
  // gains nothing and only risks the same kind of "wrong content painted
  // once, then replaced" flash.
  ssr: false,
  component: OverlayRoute,
});

function OverlayRoute() {
  const { kind, payload, contentRef, sendAction, notifyAction, requestClose, queryFrequentSites } = useOverlayHost();

  // src/styles.css's `body { background-color: var(--color-background) }`
  // (an opaque Tailwind base-layer rule, correct for the main chrome
  // window) would otherwise paint over this window's OS-level
  // transparent:true the instant anything doesn't cover the full
  // viewport — this is a completely separate document from the main
  // chrome window's (separate BrowserWindow, separate webContents), so
  // overriding it here can't affect that one.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    // The native window is always sized exactly to fit content (either
    // ResizeObserver-driven for "belowRight"/"atPoint" kinds, or fixed to
    // the owner window's full area for "cover" kinds) — so the DOCUMENT
    // itself should never need to scroll. Without this, a component with
    // its own intentional overflow-y-auto (the profile card, the bookmark
    // URL suggestion list, the tab-search results) could ALSO trigger a
    // second, redundant scrollbar at the html/body level on top of its
    // own — two scrollbars for what's visually one scrollable area.
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }, []);

  return (
    // background: transparent, no top-level padding/margin — the actual
    // native BrowserWindow is already frame:false + transparent:true (see
    // overlay-window.ts). For "belowRight"/"atPoint" kinds (profile,
    // contextmenu) it's sized exactly to this div's measured content via
    // ResizeObserver (useOverlayHost). For "cover" kinds (bookmark,
    // groupDialog, tabSearch) the native window is already sized to the
    // owner window's full content area BEFORE this ever mounts (see
    // overlay-window.ts's positionNear "cover" branch) — those render a
    // Dialog whose own content portals to this document's <body>, not
    // into contentRef, which is fine: reportSize's "cover" early-return
    // means contentRef's (empty, for these three) measured size is never
    // used to resize anything anyway.
    <div style={{ background: "transparent" }}>
      <div ref={contentRef} className="inline-block">
        {kind === "profile" && <ProfilePopupContent payload={payload as ProfileOverlayPayload} onAction={sendAction} onNotify={notifyAction} />}
        {kind === "contextmenu" && <ContextMenuContent payload={payload as ContextMenuOverlayPayload} onAction={sendAction} />}
        {kind === "downloads" && <DownloadsPopoverContent payload={payload as DownloadsOverlayPayload} onAction={sendAction} onNotify={notifyAction} />}
        {kind === "favoriteContextMenu" && <FavoriteContextMenuContent payload={payload as FavoriteContextMenuOverlayPayload} onAction={sendAction} />}
        {kind === "favoriteFolder" && <FolderContentsContent payload={payload as FavoriteFolderOverlayPayload} onAction={sendAction} onNotify={notifyAction} />}
        {kind === "tabsMenu" && (
          <ControlCenterContent payload={payload as TabsMenuOverlayPayload} onAction={sendAction} onNotify={notifyAction} />
        )}
        {kind === "tabPreview" && <TabPreviewContent payload={payload as TabPreviewOverlayPayload} />}
        {!kind && null /* nothing open yet — window sits hidden until overlay-window.ts's open() sends overlay:init */}
      </div>
      {kind === "bookmark" && (
        <BookmarkDialogContent payload={payload as BookmarkOverlayPayload} onAction={sendAction} onClose={requestClose} queryFrequentSites={queryFrequentSites} />
      )}
      {kind === "groupDialog" && <GroupDialogContent payload={payload as GroupDialogOverlayPayload} onAction={sendAction} onClose={requestClose} />}
      {kind === "tabSearch" && <TabSearchContent payload={payload as TabSearchOverlayPayload} onAction={sendAction} onClose={requestClose} />}
      {kind === "favoriteEditDialog" && <FavoriteEditDialogContent payload={payload as FavoriteEditOverlayPayload} onAction={sendAction} onClose={requestClose} />}
      {kind === "newFavoriteFolderDialog" && <NewFavoriteFolderDialogContent onAction={sendAction} onClose={requestClose} />}
    </div>
  );
}

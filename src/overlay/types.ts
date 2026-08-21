import type { ActiveIdentity, Profile } from "@/hooks/use-browser-api";

// --- Profile popup (Phase 4a) ---------------------------------------------
// Sent once when the overlay opens (see index.tsx's openProfilePopup) and
// re-sent via browserAPI.overlay.update whenever this data changes WHILE
// the popup happens to be open (index.tsx has an effect for that) — the
// overlay renderer is a separate webContents, so it can't just read these
// straight off React state/props the way the old inline <ProfilePopup />
// used to.
export type ProfileOverlayPayload = {
  profiles: Profile[];
  active: ActiveIdentity;
  loginPending: boolean;
  // True while a sync triggered from THIS popup is still in flight — the
  // reload icon spins while true. index.tsx sets this via the SAME
  // overlay.update() effect that already keeps profiles/active/
  // loginPending current (see the "syncNow" notify handler there), not
  // a separate channel — one extra boolean riding along with data that
  // was already being pushed on every relevant change anyway.
  syncing: boolean;
};

// Every one of these closes the overlay once sent (via sendAction/
// onAction) EXCEPT "syncNow" — a person reported the popup closing on
// sync felt wrong (you'd naturally want to watch it complete), so that
// one goes through onNotify/notifyAction instead (see
// ProfilePopupContent.tsx), which reports the action back to the owner
// window WITHOUT closing the overlay. Completion still surfaces as a
// toast in the main window (index.tsx's existing notify()), same as
// "Profile removed" already does — there's still no live spinner/
// "Synced" pill INSIDE the popup itself, since that would need an actual
// request/response channel across the overlay/owner-window process
// boundary, not just a fire-and-forget action.
export type ProfileOverlayAction =
  | { type: "openProfileInNewWindow"; id: string }
  | { type: "openGuestInNewWindow" }
  | { type: "openIncognitoInNewWindow" }
  | { type: "openTorInNewWindow" }
  | { type: "remove"; id: string }
  | { type: "createSimple"; name: string }
  | { type: "loginQuecksilver" }
  | { type: "syncNow" };

// --- Context menu (Phase 4b) -----------------------------------------------
export type ContextMenuOverlayPayload = {
  tabId: string;
  srcURL: string | null;
  linkURL: string | null;
  selectionText: string | null;
  isChromeUI: boolean;
};

export type ContextMenuOverlayAction =
  | { type: "openLinkHere"; url: string }
  | { type: "openLinkInNewTab"; url: string }
  | { type: "openLinkInNewWindow"; url: string }
  | { type: "copyLink"; url: string }
  | { type: "saveLinkAs"; url: string }
  | { type: "copyImage"; url: string }
  | { type: "saveImage"; url: string }
  | { type: "saveImageAs"; url: string }
  | { type: "copySelection" }
  | { type: "searchSelection"; text: string };

// --- Bookmark dialog (Phase "no more screenshots", cover mode) ------------
// Opened from index.tsx's openSlot (home-page bookmark slots). Unlike the
// profile/contextmenu overlays this one needs LIVE data while open (the
// frequent-sites URL autocomplete, re-queried on every keystroke in the
// URL field) — round-tripping that through the owner window via
// overlay.update would mean the owner re-rendering on every keystroke just
// to shuttle data through. Instead BookmarkDialogContent queries frequent
// sites directly via window.overlayAPI.frequentSites (electron/overlay-
// preload.ts + the "overlay:frequentSites" handler in main.ts, resolved
// against the OWNER window's id via OverlayWindowManager.ownerWindowId) —
// the one case an overlay talks to the main process for something other
// than open/close/resize.
export type BookmarkOverlayPayload = {
  slot: number;
  label: string;
  url: string;
};

export type BookmarkOverlayAction = { type: "save"; slot: number; label: string; url: string };

// --- New tab group dialog (cover mode) -------------------------------------
// Opened from TabStrip's onCreateGroup (index.tsx). TAB_GROUP_COLORS lives
// here (not duplicated in index.tsx and GroupDialogContent.tsx separately)
// since both the trigger (picking the initial default color) and the
// overlay content (rendering the swatches) need the exact same list.
export const TAB_GROUP_COLORS = ["#4a7c9e", "#c2694a", "#5a9e6f", "#9e7c4a", "#8a5a9e", "#4a9e9e"];

export type GroupDialogOverlayPayload = {
  tabId: string;
  defaultColor: string;
};

export type GroupDialogOverlayAction = { type: "create"; tabId: string; name: string; color: string };

// --- Tab search (Ctrl+Shift+A, cover mode) ---------------------------------
// The full tab list is already live in index.tsx's own React state, so
// (unlike the bookmark dialog) this just gets a fresh payload on open plus
// an overlay.update whenever the tab list changes while it's open — no
// separate IPC channel needed. Filtering by the typed query happens
// entirely inside TabSearchContent itself, client-side.
export type TabSearchOverlayPayload = {
  tabs: { id: string; title: string; url: string; isHome: boolean; isSettings: boolean }[];
};

export type TabSearchOverlayAction = { type: "switch"; id: string };

// --- Downloads popup (belowRight placement) --------------------------------
// Opened from the toolbar's download icon (index.tsx) instead of navigating
// to Settings → Downloads — a proper Edge-style flyout. Kept live via
// overlay.update the same way the profile popup is (index.tsx already has
// downloadItems in React state via useDownloads(), so a plain effect keyed
// on it is enough — no separate IPC channel needed the way the bookmark
// dialog's autocomplete did).
export type DownloadsOverlayPayload = {
  items: {
    id: string;
    filename: string;
    path: string;
    state: "progressing" | "completed" | "cancelled" | "interrupted";
    receivedBytes: number;
    totalBytes: number;
  }[];
};

export type DownloadsOverlayAction =
  | { type: "open"; path: string }
  | { type: "showInFolder"; path: string }
  // Soft-remove: the popup keeps SHOWING the item locally (struck-through,
  // greyed — see DownloadsPopoverContent.tsx) while this actually deletes
  // it from the real download list underneath. Sent via notifyAction (see
  // useOverlayHost), not sendAction — a person reported the whole popup
  // closing just from removing one item, which wasn't wanted; you're
  // often clearing several at once.
  | { type: "remove"; id: string }
  | { type: "openFolder" }
  | { type: "openSettings" }
  // The popup's own search icon — same destination as openSettings, but
  // tells Settings to focus its downloads search field immediately (see
  // goToSettings's "downloads:search" section id in index.tsx and the
  // matching autofocus in SettingsView.tsx).
  | { type: "openSettingsSearch" };

// --- Favorites bar right-click menu (atPoint placement) --------------------
// Opened from HeaderFavoritesBar's onContextMenu (index.tsx wires it) —
// matches Edge's own favorites-bar context menu (open in new tab/window/
// InPrivate, edit, show-icon-only toggle, cut/copy/paste, delete). Paste is
// intentionally NOT a real action here — see FavoriteContextMenuContent.tsx
// — rendered disabled to match the reference screenshot rather than wired
// to an actual "paste a favorite from clipboard" feature, which doesn't
// exist anywhere else in the app either.
export type FavoriteContextMenuOverlayPayload = {
  id: string;
  label: string;
  url: string;
  iconOnly: boolean;
  // True when this favorite currently lives inside a folder — gates
  // whether "Remove from folder" shows in the menu at all.
  inFolder: boolean;
};

export type FavoriteContextMenuOverlayAction =
  | { type: "openInNewTab"; url: string }
  | { type: "openInNewWindow"; url: string }
  | { type: "openInIncognitoWindow"; url: string }
  | { type: "edit"; id: string }
  | { type: "toggleIconOnly"; id: string; iconOnly: boolean }
  | { type: "cut"; id: string; url: string }
  | { type: "copy"; url: string }
  | { type: "removeFromFolder"; id: string }
  | { type: "newFolder" }
  | { type: "delete"; id: string };

// --- New favorites folder dialog (cover placement) --------------------------
// Opened by the favorites context menu's "New folder" — just a name
// prompt. The folder starts empty; populating it is a separate, plain
// (non-modifier) drag of other favorites directly onto it in the bar
// (see HeaderFavoritesBar.tsx's onDrop and use-header-favorites.ts's
// addToFolder) — matches Edge's own "create the folder, then drag things
// into it" flow rather than a drag gesture that also creates folders.
export type NewFavoriteFolderOverlayPayload = Record<string, never>;
export type NewFavoriteFolderOverlayAction = { type: "create"; label: string };

// --- Favorite edit dialog (cover placement) --------------------------------
// Opened from the favorites-bar context menu's "Edit" (index.tsx handles
// the "edit" action above by opening this, instead of navigating to
// Settings → Favorites for a single-item edit — that full settings page
// still exists for bulk management, this is just the quick single-item
// version, same idea as the home-page bookmark slots' own dialog).
export type FavoriteEditOverlayPayload = {
  id: string;
  label: string;
  url: string;
};

export type FavoriteEditOverlayAction = { type: "save"; id: string; label: string; url: string };

// --- Favorites folder contents (belowRight placement) ----------------------
// Opened by clicking a folder entry in the favorites bar (HeaderFavoritesBar
// filters folders' own contents OUT of the bar itself — they only ever show
// here). Deliberately minimal: clicking an item opens it and closes the
// dropdown, same as the browser's own favorites-bar folders. No drag-
// reorder or right-click editing INSIDE the dropdown for now — those still
// work by first pulling an item back out to the top level (see
// FavoriteContextMenuContent's "Remove from folder" action).
export type FavoriteFolderOverlayPayload = {
  folderId: string;
  label: string;
  items: { id: string; label: string; url: string; iconOnly: boolean }[];
};

// Split across two callbacks in FolderContentsContent.tsx, not one —
// "open" and "edit" go through onAction (closes/switches the overlay,
// same as everywhere else: opening a URL or switching to the edit dialog
// are both legitimately "done with this dropdown now"), everything else
// (right-click menu actions on an item) goes through onNotify instead,
// specifically so the folder dropdown STAYS OPEN — a person reported the
// whole folder closing just from right-clicking an item inside it, which
// wasn't wanted; those are quick one-off actions on an item you're still
// browsing through, not a reason to lose your place in the folder.
export type FavoriteFolderOverlayAction =
  | { type: "open"; url: string }
  | { type: "edit"; id: string }
  | { type: "openInNewTab"; url: string }
  | { type: "openInNewWindow"; url: string }
  | { type: "openInIncognitoWindow"; url: string }
  | { type: "toggleIconOnly"; id: string; iconOnly: boolean }
  | { type: "cut"; id: string; url: string }
  | { type: "copy"; url: string }
  | { type: "removeFromFolder"; id: string }
  | { type: "delete"; id: string };

// --- Tabs menu (belowRight placement) ---------------------------------------
// Opened from the chevron button that replaced the old QueckSilver logo
// button at the top-left of TabStrip (see TabStrip.tsx's onOpenTabsMenu).
// Deliberately minimal, unlike the full tabSearch dialog above: just the
// one "Enable vertical tabs" toggle up top, then the plain list of
// currently open tabs below it — no search field, no "recently closed"
// section. Kept live via overlay.update the same way tabSearch already is
// (index.tsx already has the tab list in React state).
export type TabsMenuOverlayPayload = {
  verticalTabsEnabled: boolean;
  tabs: { id: string; title: string; url: string; isHome: boolean; isSettings: boolean; isActive: boolean; openedAt: number }[];
};

export type TabsMenuOverlayAction = { type: "toggleVerticalTabs"; enabled: boolean } | { type: "switch"; id: string };

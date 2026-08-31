import type { ActiveIdentity, Profile } from "@/hooks/use-browser-api";
import type { SearchEngine } from "../../shared/search-engines";

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
  // True for a right-click on an otherwise "empty" spot (no image, link, or
  // selection) — drives ContextMenuContent's separate Chrome-style menu
  // (back/reload/save/print/QR/translate/screenshot/devtools). main.ts
  // already suppresses this case entirely for text fields and chrome UI, so
  // by the time it's true here the menu is always shown.
  isEmptyPage: boolean;
  // Current page URL, for the empty-page menu's QR code and translate
  // actions — null when unavailable (e.g. about:blank).
  pageUrl: string | null;
};

export type ContextMenuOverlayAction =
  | { type: "openLinkHere"; url: string }
  // tabId + isChromeUI (see the copyImage group below) — "Open in new
  // tab" needs to know the source webContents too now: a blob: URL
  // (image src OR link href) has to be read from there before a brand
  // new tab (a different renderer entirely) can show it at all.
  | { type: "openLinkInNewTab"; url: string; tabId: string; isChromeUI: boolean }
  | { type: "openLinkInNewWindow"; url: string }
  | { type: "copyLink"; url: string }
  | { type: "saveLinkAs"; url: string }
  // tabId + isChromeUI identify which webContents actually rendered the
  // image (a real tab, or the app's own UI) — needed on the main-process
  // side to read a blob: URL's bytes back out of it. See
  // electron/blob-resource.ts for why: a blob: URL only exists inside
  // the renderer that created it, so this can't be resolved from url
  // alone.
  | { type: "copyImage"; url: string; tabId: string; isChromeUI: boolean }
  | { type: "saveImage"; url: string; tabId: string; isChromeUI: boolean }
  | { type: "saveImageAs"; url: string; tabId: string; isChromeUI: boolean }
  // "Copy image address" specifically — separate from the plain "copyLink"
  // above (used for real link hrefs) so a blob: image src can be resolved
  // to a usable data: URL instead of copying dead blob: text. See
  // main.ts's "images:copyLink" handler.
  | { type: "copyImageAddress"; url: string; tabId: string; isChromeUI: boolean }
  | { type: "copySelection" }
  | { type: "searchSelection"; text: string }
  // --- Empty-page menu ----------------------------------------------------
  | { type: "goBack" }
  | { type: "reload" }
  | { type: "savePageAs" }
  | { type: "print" }
  | { type: "screenshot" }
  | { type: "openDevTools" }
  | { type: "translateToEnglish" };

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

export type GroupDialogOverlayAction = {
  type: "create";
  tabId: string;
  name: string;
  color: string;
};

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

// --- Control center (renders inside the tabsMenu overlay slot) --------------
// Renderer-side copy of electron/control-center-store.ts's types — same
// reasoning as use-privacy-settings.ts's own hand-duplicated PrivacySettings:
// the renderer never imports electron/ code directly.
export type NetworkThrottlePreset = "off" | "slow3g" | "fast3g" | "offline" | "custom";
export type DohProviderChoice = "cloudflare" | "quad9" | "google";
export type VisionFilter = "none" | "high-contrast" | "protanopia" | "deuteranopia" | "tritanopia";
export type CursorSize = "default" | "large" | "xlarge";
export type UserAgentPreset = "default" | "chrome-win" | "safari-ios" | "firefox-linux";

export type ControlCenterSettings = {
  adBlockEnabled: boolean;
  javascriptDisabled: boolean;
  cookiesBlocked: boolean;
  doNotTrack: boolean;
  autoplayBlock: boolean;
  popupBlock: boolean;
  networkThrottle: NetworkThrottlePreset;
  customDownloadKbps: number;
  customUploadKbps: number;
  customLatencyMs: number;
  dnsOverHttpsEnabled: boolean;
  dnsOverHttpsProvider: DohProviderChoice;
  customBlockedPatterns: string[];
  cameraGlobalBlock: boolean;
  micGlobalBlock: boolean;
  locationGlobalBlock: boolean;
  vpnEnabled: boolean;
  vpnKillSwitch: boolean;
  unloadBackgroundTabsOnIdle: boolean;
  autoSuspendMinutes: number;
  backgroundTabsThrottled: boolean;
  hardwareAcceleration: boolean;
  imagesDisabled: boolean;
  preloadDisabled: boolean;
  batterySaverMode: boolean;
  masterMute: boolean;
  darkModeForced: boolean;
  globalZoomFactor: number;
  visionFilter: VisionFilter;
  cursorSize: CursorSize;
  gridOverlayEnabled: boolean;
  focusMode: boolean;
  doNotDisturb: boolean;
  userAgentPreset: UserAgentPreset;
  webrtcLeakProtection: boolean;
  httpsOnlyEnforced: boolean;
  cookieAutoDelete: boolean;
  jsErrorOverlayEnabled: boolean;
};

export type DeviceEmulationPreset = "off" | "iphone14" | "ipad" | "desktop-sm";

export type PageMetadata = {
  title: string;
  titleLength: number;
  description: string | null;
  canonicalUrl: string | null;
  ogTags: { property: string; content: string }[];
};

export type RequestLogEntry = {
  url: string;
  method: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
};

export type CookieEntry = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate: number | null;
};

export type IndexedDbInfo = {
  databases: { name: string; objectStores: string[] }[];
};

export type ServiceWorkerInfo = {
  registrations: { scope: string; scriptURL: string; active: boolean }[];
};

export type RequestMock = { pattern: string; status: number; body: string };

export type ControlCenterActionType =
  | "openDevTools"
  | "reloadNoCache"
  | "clearCache"
  | "screenshot"
  | "printPdf"
  | "print"
  | "unloadTab"
  | "unloadAllBackgroundTabs"
  | "setNetworkThrottle"
  | "savePageAs"
  | "translatePage"
  | "forcePip"
  | "pauseAllMedia"
  | "muteAllMedia"
  | "toggleReaderMode"
  | "setCustomCss"
  | "fullPageScreenshot"
  | "exportPageAsMarkdown"
  | "getPageMetadata"
  | "setDeviceEmulation"
  | "startElementPicker"
  | "getRequestLog"
  | "exportConsoleLog"
  | "getCookiesForTab"
  | "setCookie"
  | "deleteCookie"
  | "getIndexedDbInfo"
  | "getServiceWorkerStatus"
  | "unregisterServiceWorkers"
  | "toggleHarRecording"
  | "setRequestMock"
  | "deleteRequestMock"
  | "getRequestMocks";

export type ControlCenterActionRequest =
  | {
      type: Exclude<
        ControlCenterActionType,
        | "setNetworkThrottle"
        | "translatePage"
        | "muteAllMedia"
        | "setCustomCss"
        | "setDeviceEmulation"
        | "setCookie"
        | "deleteCookie"
        | "setRequestMock"
        | "deleteRequestMock"
      >;
      tabId?: string;
    }
  | { type: "setNetworkThrottle"; tabId?: string; preset: NetworkThrottlePreset }
  | { type: "translatePage"; tabId?: string; langCode: string }
  | { type: "muteAllMedia"; muted: boolean }
  | { type: "setCustomCss"; tabId?: string; domain: string; css: string }
  | { type: "setDeviceEmulation"; tabId?: string; preset: DeviceEmulationPreset }
  | { type: "setCookie"; tabId?: string; name: string; value: string }
  | { type: "deleteCookie"; tabId?: string; name: string }
  | { type: "setRequestMock"; pattern: string; status: number; body: string }
  | { type: "deleteRequestMock"; pattern: string };

// --- Tabs menu (belowRight placement) ---------------------------------------
// Opened from the Control center button at the top-left of TabStrip (see
// TabStrip.tsx's onOpenTabsMenu — kept its original name/kind ("tabsMenu")
// even though ControlCenterContent.tsx now renders in this slot, to avoid
// re-wiring the overlay-kind plumbing for what's really the same trigger
// button with a bigger dropdown). Top section is the original minimal
// "Enable vertical tabs" toggle + tab list; below that, the full Control
// center grid — see ControlCenterContent.tsx. Kept live via overlay.update
// the same way tabSearch already is.
export type TabsMenuOverlayPayload = {
  verticalTabsEnabled: boolean;
  tabs: {
    id: string;
    title: string;
    url: string;
    isHome: boolean;
    isSettings: boolean;
    isActive: boolean;
    openedAt: number;
  }[];
  recentlyClosed: {
    id: string;
    title: string;
    url: string;
    isHome: boolean;
    isSettings: boolean;
    closedAt: number;
  }[];
  controlCenter: ControlCenterSettings;
  consoleErrorTotal: number;
  trackerCountForActiveTab: number;
  // Control center's "Site-Sicherheitscheck sichtbar" (masterplan #4) —
  // last check-url-safety verdict for the active tab. "unknown" until a
  // navigation has actually run the check (only happens while phishing
  // protection is on, see tab-manager.ts).
  currentSiteSafety: "safe" | "suspicious" | "unknown";
  // Control center's "Bandbreiten-Nutzung" (masterplan #10) — bytes
  // loaded by the active tab since its last navigation.
  bandwidthForActiveTab: number;
  // Control center's "Live RAM/CPU-Anzeige" (masterplan #11) — null while
  // unavailable (e.g. no active tab, or its process metrics not found).
  resourceUsageForActiveTab: { cpuPercent: number; ramMb: number } | null;
  // Custom CSS pro Domain (masterplan #16) — the active tab's domain and
  // whatever CSS is currently saved for it (empty string if none), null
  // when there's no real domain to target (home/settings tabs).
  customCssForActiveTab: { domain: string; css: string } | null;
  // Seiten-Metadaten-Check (masterplan #22) — null until the person
  // actually clicks the button (not polled), see routes/index.tsx's
  // "cc:action" handler.
  pageMetadataResult: PageMetadata | null;
  // Same lazy fetch-on-click shape as pageMetadataResult, one per
  // DevTools panel (masterplan #26/#29/#30/#31/#34).
  requestLogResult: RequestLogEntry[] | null;
  cookiesResult: CookieEntry[] | null;
  indexedDbResult: IndexedDbInfo | null;
  serviceWorkerResult: ServiceWorkerInfo | null;
  requestMocksResult: RequestMock[] | null;
};

export type TabsMenuOverlayAction =
  | { type: "toggleVerticalTabs"; enabled: boolean }
  | { type: "switch"; id: string }
  | { type: "reopenClosed"; id: string }
  // Control center additions — both go through notifyAction (see
  // overlay.tsx/ControlCenterContent.tsx), so the dropdown stays open
  // while flipping several settings in a row.
  | { type: "cc:set"; patch: Partial<ControlCenterSettings> }
  | { type: "cc:action"; request: ControlCenterActionRequest };

// --- Tab strip hover preview (belowCenter placement) -----------------------
// Opened from TabStrip.tsx on a hover timer (not a click — see
// TabStrip.tsx's armHoverPreview), closed again on mouseleave. Purely
// informational, so there's no matching Action type — nothing to pick,
// nothing for onAction to report back.
export type TabPreviewOverlayPayload = {
  imageBase64: string;
  title: string;
  // null for a home/settings tab (no real external site to show a
  // favicon/domain for — see tab-manager.ts's captureVisibleContent).
  host: string | null;
  favicon: string | null;
};

// --- Search engine chooser (belowRight placement) ---------------------------
// Opened from the URL bar's leading pill (index.tsx's openSearchEngineChooser)
// — this dropdown used to be a plain absolutely-positioned DOM panel local
// to SearchEngineChooser.tsx, which worked fine while the pill only ever
// showed on the Start page (no real native tab view under it there). Now
// that the pill is always the URL bar's leading slot, opening it over an
// actual website put the panel BEHIND that tab's native WebContentsView
// (same "native content always paints above the chrome UI" issue every
// other dropdown here already solves) — so this one moved to the same
// native overlay window architecture. SEARCH_ENGINES itself doesn't need
// to travel through the payload (its buildUrl functions aren't
// serializable across the IPC boundary anyway) — SearchEngineOverlayContent
// just imports the shared list directly, same as SettingsView does; only
// the current selection is passed through.
export type SearchEngineOverlayPayload = {
  current: SearchEngine;
};

export type SearchEngineOverlayAction = { type: "select"; id: SearchEngine };

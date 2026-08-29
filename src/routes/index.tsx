import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Columns2,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  EyeOff,
  Folder,
  Link2,
  PictureInPicture2,
  RotateCw,
  Search,
  Settings,
  SquareArrowOutUpRight,
  Star,
  User,
  X,
} from "lucide-react";
import { TorOnionLogo } from "@/components/TorOnionLogo";
import { QueckSilverLogo } from "@/components/QueckSilverLogo";
import { TabStrip } from "@/components/TabStrip";
import { SearchEngineChooser } from "@/components/SearchEngineChooser";
import { HeaderFavoritesBar } from "@/components/HeaderFavoritesBar";
import { SettingsView } from "@/components/SettingsView";
import { ZoraSidebar } from "@/components/zora/ZoraSidebar";
import { FavIcon } from "@/components/FavIcon";
import { HomeContent } from "@/components/HomeContent";
import { ZoomedContent } from "@/components/ZoomedContent";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { setPendingSettingsAnchor } from "@/lib/settings-anchor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBrowserApi, HOME_URL, SETTINGS_URL } from "@/hooks/use-browser-api";
import { useControlCenter } from "@/hooks/use-control-center";
import type {
  PageMetadata,
  RequestLogEntry,
  CookieEntry,
  IndexedDbInfo,
  ServiceWorkerInfo,
  RequestMock,
} from "@/hooks/use-control-center";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useHeaderFavorites } from "@/hooks/use-header-favorites";
import { useDownloads } from "@/hooks/use-downloads";
import {
  useToolbarIconOrder,
  useZoomLevel,
  useHeaderFavoritesBarVisible,
  useVerticalTabsEnabled,
  useVerticalTabsPinned,
  useSearchEngine,
  useOnionize,
  SEARCH_ENGINES,
  type ToolbarIconId,
} from "@/lib/settings-store";
import { VerticalTabsSidebar } from "@/components/VerticalTabsSidebar";
import { useToolbarStyle } from "@/lib/toolbar-style";
import { ToolbarActionIcons, type ToolbarAction } from "@/components/ToolbarActionIcons";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import { useTorStatus } from "@/hooks/use-tor-status";
import type {
  BookmarkOverlayAction,
  ContextMenuOverlayAction,
  DownloadsOverlayAction,
  FavoriteContextMenuOverlayAction,
  FavoriteEditOverlayAction,
  FavoriteFolderOverlayAction,
  GroupDialogOverlayAction,
  NewFavoriteFolderOverlayAction,
  ProfileOverlayAction,
  TabSearchOverlayAction,
  TabsMenuOverlayAction,
} from "@/overlay/types";
import { TAB_GROUP_COLORS } from "@/overlay/types";
import { useWindowControls } from "@/hooks/use-window-controls";
import { parseUrlBarInput, isLikelyDirectUrl } from "@/lib/url-bar";
import {
  getUrlDraft,
  setUrlDraftStored,
  clearUrlDraft,
  getHomeSearchDraft,
  setHomeSearchDraftStored,
  clearHomeSearchDraft,
  clearAllDraftsForTab,
} from "@/lib/url-draft-store";

export const Route = createFileRoute("/")({
  // This app has no public visitors to serve fast SSR HTML to or make
  // crawlable — every load is Electron's OWN chrome UI window rendering
  // itself, always with a real window.browserAPI available a moment
  // later. SSR was actively counterproductive here: the server has no
  // access to that API at all, so it always rendered the same
  // Electron-unaware fallback state (an empty tab list, defaulting to
  // "New Tab") regardless of what the window was actually supposed to
  // show — most visibly on a freshly torn-off tab, where the server-
  // rendered "New Tab" flash before React caught up and re-rendered with
  // the real, already-loaded page looked exactly like the window
  // reopening and then loading the URL, even though no navigation ever
  // happened. ssr: false skips server rendering for this route entirely,
  // so the first thing painted is the client's own correct render
  // instead of a guaranteed-wrong one that gets thrown away a moment
  // later.
  ssr: false,
  head: () => ({
    meta: [
      { title: "QueckSilver Arch" },
      { name: "description", content: "A calm, minimal desktop browser." },
      { property: "og:title", content: "QueckSilver Arch" },
      { property: "og:description", content: "A calm, minimal desktop browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function normalizeBookmarkUrl(raw: string): string {
  const parsed = parseUrlBarInput(raw);
  return parsed ?? raw.trim();
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// Zero inset, no manual border — the website fills the card completely,
// edge to edge, touching the real window boundary. That's what lets
// Windows' own DWM corner-rounding on this frameless window apply to it
// automatically, same as Edge/Chrome (see the GeoGuessr screenshot that
// confirmed this — Edge doesn't draw its own border either, it just lets
// the page reach the true window edge and Windows rounds the whole window).
// Only works while the window isn't maximized — Windows never rounds
// maximized windows, full stop, regardless of what any app does.
const CONTENT_INSET = { top: 0, right: 0, bottom: 0, left: 0 };

// See openDownloadsPopup's comment — shifts the downloads flyout's anchor
// this many pixels further right than the download icon's own edge.
// Increased from 60 — a person reported it still wasn't far enough right.
const DOWNLOADS_ANCHOR_NUDGE = 160;

// A single right-click-menu row — icon + label, rounded and inset from the
// menu's own edges (the outer menu's own p-1.5 padding is what keeps the
// hover highlight from ever touching the edge, this button just needs to
// fill that padded area and be rounded itself).
function Index() {
  const {
    tabs,
    groups,
    activeId,
    activeTab,
    secondaryId,
    secondaryTab,
    isElectron,
    newTab,
    closeTab,
    switchTab,
    reorderTabs,
    detachToWindow,
    navigate,
    goBack,
    goForward,
    reload,
    setBounds,
    setVisible,
    enterSplit,
    exitSplit,
    setDefaultZoom,
    setSplitRatio,
    setGroupCollapsed,
    createGroup,
    setTabGroup,
    togglePiP,
  } = useBrowserApi();
  const {
    settings: controlCenterSettings,
    update: updateControlCenter,
    runAction: runControlCenterAction,
    getConsoleErrorTotal,
    getTrackerCountForActiveTab,
    getCurrentSiteSafety,
    getBandwidthForActiveTab,
    getResourceUsageForActiveTab,
    getCustomCssForActiveTab,
  } = useControlCenter();
  // Cheap in-memory read on the main process side, polled only while
  // something might be showing it (the Control center dropdown) — a
  // short interval is fine since it's just a Map lookup, no disk/IPC cost
  // to speak of.
  const [consoleErrorTotal, setConsoleErrorTotal] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      void getConsoleErrorTotal().then(setConsoleErrorTotal);
    }, 3000);
    return () => clearInterval(interval);
  }, [getConsoleErrorTotal]);
  // Same polling shape as consoleErrorTotal above — Control center's
  // "Tracker blockiert" line (masterplan #5), scoped to the active tab.
  const [trackerCountForActiveTab, setTrackerCountForActiveTab] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      void getTrackerCountForActiveTab().then(setTrackerCountForActiveTab);
    }, 3000);
    return () => clearInterval(interval);
  }, [getTrackerCountForActiveTab]);
  // Same polling shape again — Control center's "Site-Sicherheitscheck
  // sichtbar" (masterplan #4), scoped to the active tab.
  const [currentSiteSafety, setCurrentSiteSafety] = useState<"safe" | "suspicious" | "unknown">(
    "unknown",
  );
  useEffect(() => {
    const interval = setInterval(() => {
      void getCurrentSiteSafety().then(setCurrentSiteSafety);
    }, 3000);
    return () => clearInterval(interval);
  }, [getCurrentSiteSafety]);
  // Control center's "Bandbreiten-Nutzung" (masterplan #10) — same
  // polling shape as the counters above, in bytes for the active tab.
  const [bandwidthForActiveTab, setBandwidthForActiveTab] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      void getBandwidthForActiveTab().then(setBandwidthForActiveTab);
    }, 3000);
    return () => clearInterval(interval);
  }, [getBandwidthForActiveTab]);
  // Control center's "Live RAM/CPU-Anzeige" (masterplan #11) — same
  // polling shape again; null while unavailable (e.g. no active tab yet).
  const [resourceUsageForActiveTab, setResourceUsageForActiveTab] = useState<{
    cpuPercent: number;
    ramMb: number;
  } | null>(null);
  useEffect(() => {
    const interval = setInterval(() => {
      void getResourceUsageForActiveTab().then(setResourceUsageForActiveTab);
    }, 3000);
    return () => clearInterval(interval);
  }, [getResourceUsageForActiveTab]);
  // Custom CSS pro Domain (masterplan #16) — same polling shape, re-fetched
  // whenever the active tab/domain changes too since it depends on activeId.
  const [customCssForActiveTab, setCustomCssForActiveTab] = useState<{
    domain: string;
    css: string;
  } | null>(null);
  useEffect(() => {
    const interval = setInterval(() => {
      void getCustomCssForActiveTab().then(setCustomCssForActiveTab);
    }, 3000);
    return () => clearInterval(interval);
  }, [getCustomCssForActiveTab]);
  // Seiten-Metadaten-Check (masterplan #22) — unlike everything else
  // polled here, this ISN'T re-fetched on an interval; it only changes
  // when the person actually clicks the button, which the "cc:action"
  // handler above sets directly.
  const [pageMetadataResult, setPageMetadataResult] = useState<PageMetadata | null>(null);
  // Stale metadata from a previous page shouldn't linger once the person
  // switches tabs — cleared, then re-fetched fresh on the next click.
  useEffect(() => {
    setPageMetadataResult(null);
  }, [activeId]);
  // Same lazy fetch-on-click pattern as pageMetadataResult above, one
  // state slot per DevTools panel (masterplan #26/#29/#30/#31/#34) — none
  // of these are polled on an interval, since (unlike bandwidth/RAM)
  // they'd mean constant CDP/executeJavaScript calls even while their
  // panel isn't open.
  const [requestLogResult, setRequestLogResult] = useState<RequestLogEntry[] | null>(null);
  const [cookiesResult, setCookiesResult] = useState<CookieEntry[] | null>(null);
  const [indexedDbResult, setIndexedDbResult] = useState<IndexedDbInfo | null>(null);
  const [serviceWorkerResult, setServiceWorkerResult] = useState<ServiceWorkerInfo | null>(null);
  const [requestMocksResult, setRequestMocksResult] = useState<RequestMock[] | null>(null);
  useEffect(() => {
    setRequestLogResult(null);
    setCookiesResult(null);
    setIndexedDbResult(null);
    setServiceWorkerResult(null);
  }, [activeId]);
  const { bookmarks, setBookmarks } = useBookmarks();
  const {
    favorites: headerFavorites,
    add: addHeaderFavorite,
    update: updateHeaderFavorite,
    remove: removeHeaderFavorite,
    reorder: reorderHeaderFavorites,
    createFolder: createHeaderFavoriteFolder,
    addToFolder: addHeaderFavoriteToFolder,
    removeFromFolder: removeHeaderFavoriteFromFolder,
  } = useHeaderFavorites();
  const { visible: headerFavoritesBarVisible } = useHeaderFavoritesBarVisible();
  const { enabled: verticalTabsEnabled, setEnabled: setVerticalTabsEnabled } =
    useVerticalTabsEnabled();
  // Reused as the vertical-tabs sidebar's own expanded/collapsed state —
  // see VerticalTabsSidebar's header comment for why this is now a
  // single always-in-flow toggle instead of a separate pinned/hover-
  // expanded pair.
  const { pinned: verticalTabsOpen, setPinned: setVerticalTabsOpen } = useVerticalTabsPinned();
  // Tabs closed recently enough to still offer "reopen" for, shown in the
  // tabs-menu dropdown's "Recently closed" section — newest first, capped
  // so the list can't grow without bound over a long session. Session-only
  // (not persisted), same as every other browser's equivalent list.
  const [recentlyClosed, setRecentlyClosed] = useState<
    {
      id: string;
      title: string;
      url: string;
      isHome: boolean;
      isSettings: boolean;
      closedAt: number;
    }[]
  >([]);
  const {
    items: downloadItems,
    open: openDownloadItem,
    showInFolder: showDownloadInFolder,
    remove: removeDownloadItem,
    openFolder: openDownloadsFolder,
  } = useDownloads();
  const activeDownloadCount = downloadItems.filter((d) => d.state === "progressing").length;
  const { order: toolbarIconOrder, moveIcon: moveToolbarIcon } = useToolbarIconOrder();
  const { engine, setEngine } = useSearchEngine();
  const { onionize, setOnionize } = useOnionize();
  const currentEngine = SEARCH_ENGINES.find((e) => e.id === engine) ?? SEARCH_ENGINES[0]!;
  const { style: toolbarStyle } = useToolbarStyle();
  const [draggedIcon, setDraggedIcon] = useState<ToolbarIconId | null>(null);
  const [zoraOpen, setZoraOpen] = useState(false);
  const { level: zoomLevel } = useZoomLevel();
  // Settings → Zoom is just the default for pages that haven't been
  // manually zoomed — pushed once per change, not reapplied on every tab
  // switch. Reapplying it on switch would fight the interactive Ctrl+
  // wheel/pinch zoom (handled entirely in the main process, see
  // tab-manager.ts) by resetting a tab you'd just zoomed the moment you
  // clicked away and back.
  useEffect(() => {
    setDefaultZoom(zoomLevel / 100);
  }, [zoomLevel, setDefaultZoom]);
  // Briefly shows a green checkmark on the toolbar button right after a
  // download finishes — tracked by comparing each download's state against
  // what it was the previous render, not just "is anything completed"
  // (which would stay true forever once the first download ever finishes).
  const [justCompletedDownload, setJustCompletedDownload] = useState(false);
  const prevDownloadStatesRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const d of downloadItems) {
      const prev = prevDownloadStatesRef.current.get(d.id);
      if (prev === "progressing" && d.state === "completed") {
        setJustCompletedDownload(true);
        setTimeout(() => setJustCompletedDownload(false), 2000);
      }
    }
    prevDownloadStatesRef.current = new Map(downloadItems.map((d) => [d.id, d.state]));
  }, [downloadItems]);
  const { pending: authPending, login, cancelLogin } = useAuth();
  const {
    profiles,
    active: activeIdentity,
    activeProfile,
    isGuest,
    createSimpleProfile,
    removeProfile,
    syncNow,
    openProfileInNewWindow,
    openGuestInNewWindow,
    openIncognitoInNewWindow,
    openTorInNewWindow,
  } = useProfiles();
  const isTorWindow = activeIdentity.windowMode === "tor";
  // Drives the Start page's privacy explainer (see HomeContent) instead of
  // the usual 5 bookmark tiles - "guest" covers both plain guest mode and
  // incognito/tor (which are guest mode plus a windowMode), so this checks
  // windowMode first for the more specific label.
  const homePrivacyMode: "incognito" | "tor" | "guest" | null =
    activeIdentity.windowMode === "tor"
      ? "tor"
      : activeIdentity.windowMode === "incognito"
        ? "incognito"
        : activeIdentity.guestMode
          ? "guest"
          : null;
  const { status: torStatus, newIdentity: torNewIdentity } = useTorStatus();
  const {
    minimize,
    toggleMaximize,
    close: closeWindow,
    isMaximized,
    setFullScreen,
    getIsFullscreen,
    onShortcutF11,
    onShortcutEscape,
    onShortcutFocusUrlBar,
    onShortcutAddFavorite,
    onShortcutFindInPage,
    onShortcutTabSearch,
    onShortcutOpenPasswordSettings,
    onFullscreenChanged,
  } = useWindowControls();

  const platform = typeof window !== "undefined" ? window.platformInfo?.platform : undefined;
  const hasNativeControls = platform === "darwin";

  // F11 "fullscreen" — mirrors the window's real fullscreen state, updated
  // only via the authoritative onFullscreenChanged event (see toggleChrome
  // below) so it can never get stuck out of sync with what Electron/Windows
  // actually did.
  const [chromeHidden, setChromeHidden] = useState(false);

  // openBookmark itself is defined much further down (needs activeId/
  // navigate/newTab/setUrlDraft, all in scope by then) — but the overlay
  // onAction effect that needs to call it (for the favorites-folder
  // dropdown's "open" action) runs much earlier in this component body.
  // A ref sidesteps the "used before it was initialized" ordering issue
  // entirely, same pattern as tabsRef/editingUrlRef further below.
  const openBookmarkRef = useRef<(url: string, targetId?: string | null) => void>(() => {});

  // Opening the profile menu now opens the native overlay window instead
  // of an inline DOM panel (see electron/overlay-window.ts and
  // src/overlay/ProfilePopupContent.tsx, Phase 4a of the native-overlay
  // plan) — no local open/closed state needed here anymore, the overlay
  // window's own visibility IS that state. anchorRect is still captured
  // the same way (getBoundingClientRect() of the button at click time),
  // just handed to the main process instead of used for local CSS
  // positioning.
  const [profileSyncing, setProfileSyncing] = useState(false);
  const openProfilePopup = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    window.browserAPI?.overlay.open(
      "profile",
      { profiles, active: activeIdentity, loginPending: authPending, syncing: profileSyncing },
      { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
    );
  };
  // Keeps an already-open profile overlay's content current if the
  // profiles list, active identity, login-pending, or sync-in-progress
  // state changes while it's open (e.g. another window finishes a
  // QueckSilver login, or THIS window's own "syncNow" notify handler
  // below flips profileSyncing) — see overlay-window.ts's update(), a
  // no-op if "profile" isn't the kind currently open.
  useEffect(() => {
    window.browserAPI?.overlay.update("profile", {
      profiles,
      active: activeIdentity,
      loginPending: authPending,
      syncing: profileSyncing,
    });
  }, [profiles, activeIdentity, authPending, profileSyncing]);
  // Downloads flyout — opens the native overlay instead of navigating to
  // Settings → Downloads (see ToolbarActionIcons' widened onClick type for
  // why this can read the button's own position). Kept live via the
  // update() effect right below it, same pattern as the profile popup
  // above — downloadItems already changes over time (progress updates)
  // whether or not the flyout happens to be open. Nudged further right
  // than the button's own edge (DOWNLOADS_ANCHOR_NUDGE) — a person
  // reported the flyout sitting too far left relative to the toolbar's
  // true right edge; the download icon itself isn't necessarily the
  // rightmost thing in every toolbar style (profile/sync sit further
  // right in some), so anchoring exactly to ITS edge undershoots that.
  //
  // "Remove" itself (the struck-through-for-5s-then-gone behavior) is now
  // handled entirely inside DownloadsPopoverContent.tsx as local state —
  // this window's own side of it is just the plain, ordinary download
  // list, nothing removal-specific to track here at all anymore.
  const openDownloadsPopup = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    window.browserAPI?.overlay.open(
      "downloads",
      { items: downloadItems },
      {
        top: r.top,
        left: r.left + DOWNLOADS_ANCHOR_NUDGE,
        right: r.right + DOWNLOADS_ANCHOR_NUDGE,
        bottom: r.bottom,
      },
    );
  };
  useEffect(() => {
    window.browserAPI?.overlay.update("downloads", { items: downloadItems });
  }, [downloadItems]);
  // Auto-opens the downloads flyout the moment a NEW download starts —
  // "the old download state is still there" was reported after the
  // click-to-open flow started working: the toolbar's own busy-spinner
  // still needed a click before you'd ever see live progress anywhere.
  // This shows it automatically instead, no click needed. Reads the
  // download icon's own DOM position (data-qs-download-anchor, applied
  // in ToolbarActionIcons' shared drag() helper so it's present across
  // all 17 toolbar styles) rather than a stored ref, since this is the
  // one moment it's guaranteed to already be in the DOM — activeDownload
  // just became truthy, so React has already committed it by the time
  // this effect runs.
  const prevActiveDownloadCount = useRef(0);
  useEffect(() => {
    if (prevActiveDownloadCount.current === 0 && activeDownloadCount > 0) {
      const el = document.querySelector("[data-qs-download-anchor]");
      if (el) {
        const r = el.getBoundingClientRect();
        window.browserAPI?.overlay.open(
          "downloads",
          { items: downloadItems },
          {
            top: r.top,
            left: r.left + DOWNLOADS_ANCHOR_NUDGE,
            right: r.right + DOWNLOADS_ANCHOR_NUDGE,
            bottom: r.bottom,
          },
        );
      }
    }
    prevActiveDownloadCount.current = activeDownloadCount;
  }, [activeDownloadCount, downloadItems]);
  // Executes whatever the person picked in the profile overlay — the
  // overlay renderer itself has no access to useProfiles()/useAuth()'s
  // actual Supabase/IPC-backed logic (separate webContents, separate
  // preload — see overlay-preload.ts), so it just reports back what was
  // chosen and this window's own existing hooks do the real work, exactly
  // like the old inline <ProfilePopup> callbacks used to.
  useEffect(() => {
    return window.browserAPI?.overlay.onAction((event) => {
      if (event.kind === "profile") {
        const action = event.action as ProfileOverlayAction;
        switch (action.type) {
          case "openProfileInNewWindow":
            openProfileInNewWindow(action.id);
            break;
          case "openGuestInNewWindow":
            openGuestInNewWindow();
            break;
          case "openIncognitoInNewWindow":
            openIncognitoInNewWindow();
            break;
          case "openTorInNewWindow":
            openTorInNewWindow();
            break;
          case "remove":
            removeProfile(action.id);
            notify("Profile removed");
            break;
          case "createSimple":
            createSimpleProfile(action.name);
            break;
          case "loginQuecksilver":
            login("new-profile");
            break;
          case "syncNow":
            // The popup's reload icon now spins based on this state
            // (payload.syncing, pushed via the overlay.update() effect
            // above) instead of the old inline popup's local spinner —
            // see ProfileOverlayAction's "syncNow" comment in
            // src/overlay/types.ts for why a live in-popup await isn't
            // available across the overlay/owner-window process
            // boundary; this is the closest equivalent that is.
            setProfileSyncing(true);
            {
              const result = syncNow();
              if (result) void result.finally(() => setProfileSyncing(false));
              else setProfileSyncing(false);
            }
            break;
        }
        return;
      }
      if (event.kind === "contextmenu") {
        const action = event.action as ContextMenuOverlayAction;
        switch (action.type) {
          case "openLinkHere":
            // tabId isn't in the action itself (the overlay content never
            // needed it — see ContextMenuContent.tsx), but there's only
            // ever one active tab a context menu could have come from.
            if (activeId) window.browserAPI?.links.openHere(activeId, action.url);
            break;
          case "openLinkInNewTab":
            window.browserAPI?.links.openInNewTab(action.url, action.tabId, action.isChromeUI);
            break;
          case "openLinkInNewWindow":
            window.browserAPI?.links.openInNewWindow(action.url);
            break;
          case "copyLink":
            window.browserAPI?.links.copy(action.url);
            break;
          case "saveLinkAs":
            window.browserAPI?.links.saveAs(action.url);
            break;
          case "copyImage":
            window.browserAPI?.images.copy(action.url, action.tabId, action.isChromeUI);
            break;
          case "saveImage":
            window.browserAPI?.images.saveDirect(action.url, action.tabId, action.isChromeUI);
            break;
          case "saveImageAs":
            window.browserAPI?.images.save(action.url, action.tabId, action.isChromeUI);
            break;
          case "copyImageAddress":
            window.browserAPI?.images.copyLink(action.url, action.tabId, action.isChromeUI);
            break;
          case "copySelection":
            if (activeId) window.browserAPI?.tabs.copySelectionFor(activeId);
            break;
          case "searchSelection":
            window.browserAPI?.tabs.new(currentEngine.buildUrl(action.text));
            break;
          case "goBack":
            if (activeId) void goBack(activeId);
            break;
          case "reload":
            if (activeId) void reload(activeId);
            break;
          case "savePageAs":
            void runControlCenterAction({ type: "savePageAs" });
            break;
          case "print":
            void runControlCenterAction({ type: "print" });
            break;
          case "screenshot":
            void runControlCenterAction({ type: "screenshot" });
            break;
          case "openDevTools":
            void runControlCenterAction({ type: "openDevTools" });
            break;
          case "translateToEnglish":
            void runControlCenterAction({ type: "translatePage", langCode: "en" });
            break;
        }
        return;
      }
      if (event.kind === "bookmark") {
        const action = event.action as BookmarkOverlayAction;
        if (action.type === "save") {
          const url = normalizeBookmarkUrl(action.url);
          setBookmarks((prev) =>
            prev.map((b, i) => (i === action.slot ? { label: action.label, url } : b)),
          );
          notifySuccess("Bookmark saved");
        }
        return;
      }
      if (event.kind === "groupDialog") {
        const action = event.action as GroupDialogOverlayAction;
        if (action.type === "create") {
          void (async () => {
            const groupId = await createGroup(action.name, action.color);
            if (groupId) setTabGroup(action.tabId, groupId);
          })();
        }
        return;
      }
      if (event.kind === "tabSearch") {
        const action = event.action as TabSearchOverlayAction;
        if (action.type === "switch") switchTab(action.id);
        return;
      }
      if (event.kind === "tabsMenu") {
        const action = event.action as TabsMenuOverlayAction;
        if (action.type === "toggleVerticalTabs") setVerticalTabsEnabled(action.enabled);
        else if (action.type === "switch") switchTab(action.id);
        else if (action.type === "reopenClosed") {
          const entry = recentlyClosed.find((t) => t.id === action.id);
          if (entry) {
            newTab(entry.url);
            setRecentlyClosed((prev) => prev.filter((t) => t.id !== action.id));
          }
        } else if (action.type === "cc:set") {
          void updateControlCenter(action.patch);
        } else if (action.type === "cc:action") {
          // Every Control center action whose whole point is the
          // returned data (not a side effect) is captured here and
          // pushed back out through the same overlay.update payload the
          // rest of this effect already sends, since the overlay itself
          // has no direct IPC return path (see ControlCenterContent.tsx's
          // own header comment). Mutating actions that a panel needs to
          // reflect immediately (cookie/mock edits) re-fetch their list
          // right after, instead of waiting for the person to close and
          // reopen the panel.
          const req = action.request;
          if (req.type === "getPageMetadata") {
            void runControlCenterAction(req)?.then((result) => {
              setPageMetadataResult(result as PageMetadata | null);
            });
          } else if (req.type === "getRequestLog") {
            void runControlCenterAction(req)?.then((result) => {
              setRequestLogResult(result as RequestLogEntry[]);
            });
          } else if (req.type === "getCookiesForTab") {
            void runControlCenterAction(req)?.then((result) => {
              setCookiesResult(result as CookieEntry[]);
            });
          } else if (req.type === "setCookie" || req.type === "deleteCookie") {
            void runControlCenterAction(req)?.then(() => {
              void runControlCenterAction({ type: "getCookiesForTab" })?.then((result) => {
                setCookiesResult(result as CookieEntry[]);
              });
            });
          } else if (req.type === "getIndexedDbInfo") {
            void runControlCenterAction(req)?.then((result) => {
              setIndexedDbResult(result as IndexedDbInfo);
            });
          } else if (req.type === "getServiceWorkerStatus") {
            void runControlCenterAction(req)?.then((result) => {
              setServiceWorkerResult(result as ServiceWorkerInfo);
            });
          } else if (req.type === "unregisterServiceWorkers") {
            void runControlCenterAction(req)?.then(() => {
              void runControlCenterAction({ type: "getServiceWorkerStatus" })?.then((result) => {
                setServiceWorkerResult(result as ServiceWorkerInfo);
              });
            });
          } else if (req.type === "getRequestMocks") {
            void runControlCenterAction(req)?.then((result) => {
              setRequestMocksResult(result as RequestMock[]);
            });
          } else if (req.type === "setRequestMock" || req.type === "deleteRequestMock") {
            void runControlCenterAction(req)?.then(() => {
              void runControlCenterAction({ type: "getRequestMocks" })?.then((result) => {
                setRequestMocksResult(result as RequestMock[]);
              });
            });
          } else {
            void runControlCenterAction(req);
          }
        }
        return;
      }
      if (event.kind === "downloads") {
        const action = event.action as DownloadsOverlayAction;
        switch (action.type) {
          case "open":
            openDownloadItem(action.path);
            break;
          case "showInFolder":
            showDownloadInFolder(action.path);
            break;
          case "remove":
            // The struck-through-for-5s-then-gone display is now entirely
            // DownloadsPopoverContent.tsx's own local concern (a plain
            // setTimeout there delays sending this exact action) — by the
            // time it arrives here, the 5s has already elapsed and this
            // is just an ordinary, real removal.
            removeDownloadItem(action.id);
            break;
          case "openFolder":
            openDownloadsFolder();
            break;
          case "openSettings":
            goToSettings("downloads");
            break;
          case "openSettingsSearch":
            goToSettings("downloads:search");
            break;
        }
        return;
      }
      if (event.kind === "favoriteContextMenu") {
        const action = event.action as FavoriteContextMenuOverlayAction;
        switch (action.type) {
          case "openInNewTab":
            window.browserAPI?.tabs.new(action.url);
            break;
          case "openInNewWindow":
            window.browserAPI?.links.openInNewWindow(action.url);
            break;
          case "openInIncognitoWindow":
            window.browserAPI?.links.openInIncognitoWindow(action.url);
            break;
          case "edit": {
            const fav = headerFavorites.find((f) => f.id === action.id);
            if (fav) {
              window.browserAPI?.overlay.open(
                "favoriteEditDialog",
                { id: fav.id, label: fav.label, url: fav.url },
                { top: 0, left: 0, right: 0, bottom: 0, placement: "cover" },
              );
            }
            break;
          }
          case "toggleIconOnly":
            updateHeaderFavorite(action.id, { iconOnly: action.iconOnly });
            break;
          case "cut":
            window.browserAPI?.links.copy(action.url);
            removeHeaderFavorite(action.id);
            break;
          case "copy":
            window.browserAPI?.links.copy(action.url);
            break;
          case "removeFromFolder":
            removeHeaderFavoriteFromFolder(action.id);
            break;
          case "newFolder":
            window.browserAPI?.overlay.open(
              "newFavoriteFolderDialog",
              {},
              { top: 0, left: 0, right: 0, bottom: 0, placement: "cover" },
            );
            break;
          case "delete":
            removeHeaderFavorite(action.id);
            break;
        }
        return;
      }
      if (event.kind === "favoriteEditDialog") {
        const action = event.action as FavoriteEditOverlayAction;
        if (action.type === "save")
          updateHeaderFavorite(action.id, { label: action.label, url: action.url });
        return;
      }
      if (event.kind === "newFavoriteFolderDialog") {
        const action = event.action as NewFavoriteFolderOverlayAction;
        if (action.type === "create") createHeaderFavoriteFolder(action.label);
        return;
      }
      if (event.kind === "favoriteFolder") {
        const action = event.action as FavoriteFolderOverlayAction;
        switch (action.type) {
          case "open":
            openBookmarkRef.current(action.url);
            break;
          case "edit": {
            const fav = headerFavorites.find((f) => f.id === action.id);
            if (fav) {
              window.browserAPI?.overlay.open(
                "favoriteEditDialog",
                { id: fav.id, label: fav.label, url: fav.url },
                { top: 0, left: 0, right: 0, bottom: 0, placement: "cover" },
              );
            }
            break;
          }
          case "openInNewTab":
            window.browserAPI?.tabs.new(action.url);
            break;
          case "openInNewWindow":
            window.browserAPI?.links.openInNewWindow(action.url);
            break;
          case "openInIncognitoWindow":
            window.browserAPI?.links.openInIncognitoWindow(action.url);
            break;
          case "toggleIconOnly":
            updateHeaderFavorite(action.id, { iconOnly: action.iconOnly });
            break;
          case "cut":
            window.browserAPI?.links.copy(action.url);
            removeHeaderFavorite(action.id);
            break;
          case "copy":
            window.browserAPI?.links.copy(action.url);
            break;
          case "removeFromFolder":
            removeHeaderFavoriteFromFolder(action.id);
            break;
          case "delete":
            removeHeaderFavorite(action.id);
            break;
        }
      }
    });
  }, [
    openProfileInNewWindow,
    openGuestInNewWindow,
    openIncognitoInNewWindow,
    openTorInNewWindow,
    removeProfile,
    createSimpleProfile,
    login,
    syncNow,
    activeId,
    currentEngine,
    setBookmarks,
    createGroup,
    setTabGroup,
    switchTab,
    openDownloadItem,
    showDownloadInFolder,
    removeDownloadItem,
    openDownloadsFolder,
    headerFavorites,
    updateHeaderFavorite,
    removeHeaderFavorite,
    removeHeaderFavoriteFromFolder,
    createHeaderFavoriteFolder,
    recentlyClosed,
    newTab,
  ]);
  const [urlDraft, setUrlDraft] = useState("");
  const [homeUrlDraft, setHomeUrlDraft] = useState("");
  const [secondaryHomeUrlDraft, setSecondaryHomeUrlDraft] = useState("");
  const [urlCopied, setUrlCopied] = useState(false);
  const [autoSavedPill, setAutoSavedPill] = useState<{ url: string; username: string } | null>(
    null,
  );
  // Offered once at startup (see session:getRecovery) — same capsule slot
  // as the password-saved pill, just with a Restore/Dismiss choice instead
  // of auto-dismissing. Takes priority over autoSavedPill since it's a
  // decision the person needs to actually make, not just a passing status.
  const [sessionRestore, setSessionRestore] = useState<{ tabCount: number } | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    return window.browserAPI?.appUpdate.onReady(() => setUpdateReady(true));
  }, []);
  // Ctrl+F — same toolbar slot again. null = closed.
  const [findBar, setFindBar] = useState<{
    query: string;
    matches: number;
    activeMatchOrdinal: number;
  } | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  // Ctrl+Shift+A — command-palette-style tab search. Now a native "cover"
  // overlay window (see src/overlay/TabSearchContent.tsx) instead of an
  // inline Dialog — no open/query state needed here anymore, just keeping
  // an already-open overlay's tab list current (mirrors the profile
  // popup's own overlay.update effect above).
  useEffect(() => {
    window.browserAPI?.overlay.update("tabSearch", {
      tabs: tabs.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        isHome: t.isHome,
        isSettings: t.isSettings,
      })),
    });
  }, [tabs]);
  // Keeps the tabs-menu dropdown (TabsMenuContent) current while it's
  // open — same idea as the tabSearch effect right above, just also
  // carrying the vertical-tabs toggle's own current state, the tab list,
  // and the recently-closed list along.
  useEffect(() => {
    window.browserAPI?.overlay.update("tabsMenu", {
      verticalTabsEnabled,
      tabs: tabs.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        isHome: t.isHome,
        isSettings: t.isSettings,
        isActive: t.id === activeId,
        openedAt: t.openedAt,
      })),
      recentlyClosed,
      controlCenter: controlCenterSettings,
      consoleErrorTotal,
      trackerCountForActiveTab,
      currentSiteSafety,
      bandwidthForActiveTab,
      resourceUsageForActiveTab,
      customCssForActiveTab,
      pageMetadataResult,
      requestLogResult,
      cookiesResult,
      indexedDbResult,
      serviceWorkerResult,
      requestMocksResult,
    });
  }, [
    tabs,
    activeId,
    verticalTabsEnabled,
    recentlyClosed,
    controlCenterSettings,
    consoleErrorTotal,
    trackerCountForActiveTab,
    currentSiteSafety,
    bandwidthForActiveTab,
    resourceUsageForActiveTab,
    customCssForActiveTab,
    pageMetadataResult,
    requestLogResult,
    cookiesResult,
    indexedDbResult,
    serviceWorkerResult,
    requestMocksResult,
  ]);
  // Right-click on an image/link/selection inside a tab now opens the
  // native overlay window directly from the main process — see
  // electron/main.ts's showContextMenu and src/overlay/ContextMenuContent
  // (Phase 4b of the native-overlay plan). No renderer-side state for it
  // anymore: the old contextMenu state, its screenshot-backdrop JSX, and
  // the mousedown/wheel close-on-outside-click handling all lived here
  // specifically to fake a DOM popup sitting above the tab's native view;
  // none of that's needed once the menu is a genuinely separate native
  // window the OS itself layers on top.
  // A freshly-opened tab's home page fades in with a brief loading spinner
  // around the search icon, like a real page that just finished loading —
  // only once per tab (tracked by id), not every time you switch back to
  // an already-open home tab.
  const [loadingHomeTabs, setLoadingHomeTabs] = useState<Set<string>>(new Set());
  const knownTabIdsRef = useRef<Set<string>>(new Set());
  const urlBarRef = useRef<HTMLInputElement | null>(null);
  // Tabs that were just created and still need the header search bar
  // focused once their content actually mounts (the input doesn't exist in
  // the DOM until the loading placeholder above clears, so focusing it
  // right when the tab is first detected would hit a null ref).
  const needsFocusRef = useRef<Set<string>>(new Set());
  // The very first run of the effect below sees the app's startup tab(s)
  // as "new" too, purely because knownTabIdsRef starts out empty — nothing
  // was actually just opened by the person. Skipping focus specifically
  // for that first run (while leaving the loading-spinner animation
  // untouched, since that's a reasonable "app is opening" look either way)
  // is what keeps the address bar from stealing focus the instant the
  // browser launches.
  const isFirstTabsRunRef = useRef(true);

  useEffect(() => {
    const currentIds = new Set(tabs.map((t) => t.id));
    // tabs starts out empty (before the backend's IPC response with the
    // real startup tab even arrives) — treating THAT empty run as "the
    // first run" would flip the guard before the startup tab has actually
    // shown up, leaving it unprotected once it does. Only the first run
    // that actually has tabs in it counts.
    const isFirstMeaningfulRun = isFirstTabsRunRef.current && tabs.length > 0;
    if (tabs.length > 0) isFirstTabsRunRef.current = false;
    for (const tab of tabs) {
      if (tab.isHome && !knownTabIdsRef.current.has(tab.id)) {
        setLoadingHomeTabs((prev) => new Set(prev).add(tab.id));
        if (!isFirstMeaningfulRun) needsFocusRef.current.add(tab.id);
        setTimeout(() => {
          setLoadingHomeTabs((prev) => {
            const next = new Set(prev);
            next.delete(tab.id);
            return next;
          });
        }, 300);
      }
    }
    knownTabIdsRef.current = currentIds;
  }, [tabs]);

  const isHomeLoading = Boolean(activeId && loadingHomeTabs.has(activeId));

  const contentRef = useRef<HTMLDivElement | null>(null);
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const isHome = activeTab?.isHome ?? true;
  const isSettings = activeTab?.isSettings ?? false;
  // Night mode moved into Settings (see SettingsView's own toggle) — but
  // opening Settings replaces the SAME tab's content in place (it's the
  // "isSettings" flag on that tab, not a separate one), so by the time
  // someone is looking at the toggle, tabs.getActiveId() would just point
  // at the Settings page itself, not the real page they want dark. This
  // remembers whichever tab was actually showing real content last, so
  // the toggle has something meaningful to act on.
  const lastBrowsedTabRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeId && !isHome && !isSettings) lastBrowsedTabRef.current = activeId;
  }, [activeId, isHome, isSettings]);

  // Runs every render, so it naturally fires on whichever render is the
  // first one where urlBarRef.current genuinely exists. The header address
  // bar (unlike HomeContent's own search bar) isn't gated behind the
  // loading placeholder at all, so this doesn't need to wait for that to
  // clear either — focusing as soon as this tab is genuinely active.
  useEffect(() => {
    if (activeId && needsFocusRef.current.has(activeId) && isHome && urlBarRef.current) {
      urlBarRef.current.focus();
      needsFocusRef.current.delete(activeId);
    }
  });

  // Bookmark editor, new-group, and tab search are all native "cover"
  // overlay windows now (see src/overlay/{Bookmark,GroupDialog,TabSearch}
  // Content.tsx) — genuinely separate windows the OS layers on top, so
  // unlike the old inline Dialogs, none of them need the active tab's
  // native view hidden anymore. Nothing left here that ever needs to hide
  // it for a dialog's sake.

  const [editingUrl, setEditingUrl] = useState(false);
  // Frequent-sites AND favorites autocomplete — see
  // electron/frequent-sites-store.ts for why the frequent-sites half is
  // domain-only (never a URL/path), matching "no history". Favorites
  // (header bar + the 5 home-page slots) are already loaded client-side,
  // so those are checked synchronously/instantly; frequent-sites needs an
  // IPC round trip, so it's the fallback when nothing local matches.
  // Inline completion (like every real browser's address bar) instead of a
  // separate dropdown list: the matching domain's remaining characters get
  // appended directly into the field and shown pre-selected (native blue
  // text-selection highlight) — typing further replaces them, Enter or
  // Tab/Right-arrow accepts them as-is.
  //
  // programmaticUrlChangeRef distinguishes "urlDraft changed because WE
  // just appended a suggestion" from "urlDraft changed because the person
  // typed" — without it, appending a suggestion would itself re-trigger
  // this effect (urlDraft changed) and loop.
  const programmaticUrlChangeRef = useRef(false);
  const favoriteDomains = useMemo(() => {
    const domains = new Set<string>();
    for (const f of headerFavorites) {
      try {
        domains.add(new URL(f.url).hostname);
      } catch {
        /* not a real URL — skip */
      }
    }
    for (const b of bookmarks) {
      if (!b) continue;
      try {
        domains.add(new URL(b.url).hostname);
      } catch {
        /* not a real URL — skip */
      }
    }
    return [...domains];
  }, [headerFavorites, bookmarks]);
  // Set by applyCompletion below, consumed (and cleared) by the
  // useLayoutEffect right after it — see that effect's comment for why
  // this two-step handoff, instead of just calling setSelectionRange
  // directly after setUrlDraft, is the part that was actually missing.
  const pendingCompletionSelectionRef = useRef<{ start: number; end: number } | null>(null);
  // Cache of the last frequent-sites lookup — lets the very next keystroke
  // (if it still matches) reapply a completion synchronously from this
  // instead of waiting on a fresh IPC round trip, which is what was
  // closing most of the remaining flicker gap (see the effect body below
  // for the full explanation of where that gap comes from).
  const cachedFrequentSitesRef = useRef<
    { domain: string; visitCount: number; lastVisit: number }[]
  >([]);
  // Set (to a LENGTH, not the exact string) when Backspace/Delete removes
  // characters — see the onKeyDown Backspace branch for why length-based:
  // a single further keystroke always produces a "different string", which
  // would trivially satisfy a string-equality check and let suggestions
  // resume after just one more character. The actual ask was "stay off
  // until 2 genuinely new characters have been typed past the deletion
  // point" — comparing lengths is what that needs.
  const dismissedAtLengthRef = useRef<number | null>(null);
  // Shared by the keydown handler below (which needs a synchronous answer,
  // no round trip) and the effect right after it (which also refreshes
  // this against fresh IPC data) — favorites first (always current,
  // already loaded), then whatever frequent-sites data is cached from the
  // last IPC response.
  const computeBestMatch = (typedValue: string): string | null => {
    const favoriteMatch = favoriteDomains.find(
      (d) => d.length > typedValue.length && d.toLowerCase().startsWith(typedValue.toLowerCase()),
    );
    if (favoriteMatch) return favoriteMatch;
    const cachedMatch = cachedFrequentSitesRef.current
      .filter(
        (s) =>
          s.domain.length > typedValue.length &&
          s.domain.toLowerCase().startsWith(typedValue.toLowerCase()),
      )
      .sort((a, b) => b.visitCount - a.visitCount)[0];
    return cachedMatch?.domain ?? null;
  };
  useEffect(() => {
    if (!editingUrl) return;
    if (programmaticUrlChangeRef.current) {
      programmaticUrlChangeRef.current = false;
      return;
    }
    // Waits for at least 3 typed characters — completing after just 1
    // matches too broadly (almost anything starts with one letter) and
    // felt like it was guessing rather than actually completing.
    if (urlDraft.trim().length < 3) return;
    if (dismissedAtLengthRef.current !== null) {
      if (urlDraft.length < dismissedAtLengthRef.current + 2) return;
      dismissedAtLengthRef.current = null; // typed enough past the dismiss point — suggestions can resume
    }
    const typedValue = urlDraft;
    const applyCompletion = (domain: string) => {
      const completed = typedValue + domain.slice(typedValue.length);
      programmaticUrlChangeRef.current = true;
      // Every previous version of this (setSelectionRange straight after
      // setUrlDraft, with or without flushSync, with or without also
      // writing .value directly first) ran into the same root problem:
      // this is a CONTROLLED input (value={urlDraft}), and React tracks
      // its OWN idea of what that input's value currently is, separate
      // from whatever the DOM node's real .value happens to hold. Any
      // direct DOM write here (mine or otherwise) is invisible to that
      // tracking — so on React's very next render of this input (which
      // setUrlDraft always triggers), React compares the new value
      // against ITS OWN last-known value, sees a mismatch, and
      // re-assigns node.value itself to "fix" it. Assigning .value
      // natively always collapses/moves the selection to the end as a
      // side effect — which is exactly what was wiping the highlight
      // and stranding the caret on the right, no matter how carefully
      // the call ordering leading up to that assignment was arranged.
      // useLayoutEffect below runs synchronously right after THAT
      // render's DOM mutations are committed (and before the browser
      // paints anything) — i.e. strictly after React's own value-fixing
      // write has already happened, which is the one point in this whole
      // cycle where setSelectionRange can no longer be undone by it.
      pendingCompletionSelectionRef.current = { start: typedValue.length, end: completed.length };
      setUrlDraft(completed);
    };
    // Favorites/cache handled synchronously by the keydown handler
    // already (see onKeyDown below) for the common case of "still typing
    // characters that keep matching" — this only needs to catch it here
    // too for paths that don't go through a keydown at all (the initial
    // 3rd keystroke reaching the threshold, a value set some other way).
    const syncMatch = computeBestMatch(typedValue);
    if (syncMatch) {
      applyCompletion(syncMatch);
      return;
    }
    let cancelled = false;
    window.browserAPI?.frequentSites.list(typedValue).then((results) => {
      if (cancelled) return;
      cachedFrequentSitesRef.current = results;
      const top = results[0];
      if (
        !top ||
        top.domain.length <= typedValue.length ||
        !top.domain.toLowerCase().startsWith(typedValue.toLowerCase())
      )
        return;
      applyCompletion(top.domain);
    });
    return () => {
      cancelled = true;
    };
  }, [editingUrl, urlDraft]);
  // Runs synchronously right after React commits urlDraft's new value to
  // the DOM (useLayoutEffect, not useEffect — the timing difference is
  // the whole point here, see applyCompletion's comment above) and, if
  // applyCompletion just queued one, applies the completion's selection
  // then. This is the one point in the whole cycle guaranteed to run
  // AFTER React's own controlled-input value write for this change, so
  // there's nothing left afterward that can still collapse it.
  useLayoutEffect(() => {
    const pending = pendingCompletionSelectionRef.current;
    if (!pending) return;
    pendingCompletionSelectionRef.current = null;
    urlBarRef.current?.setSelectionRange(pending.start, pending.end);
  }, [urlDraft]);
  const editingUrlRef = useRef(false);
  editingUrlRef.current = editingUrl;
  // Read inside onShortcutTabSearch below — that effect only resubscribes
  // on chromeHidden changing (same minimal-deps pattern as its neighbors),
  // so closing over `tabs` directly there would freeze the list at
  // whatever it was on the last resubscribe instead of the tab search
  // overlay's own live overlay.update effect keeping it current.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // Tracks the PREVIOUS activeId so the effect below can tell "a real
  // navigation landed on the tab we're already looking at" (should still
  // overwrite the draft with the new URL, same as before) apart from "we
  // just switched to a different tab" (should restore whatever was left
  // sitting in that other tab's own draft, if anything, instead of
  // resetting it) — see url-draft-store.ts for why that draft survives
  // across the switch in the first place.
  const prevActiveIdRef = useRef(activeId);
  useEffect(() => {
    const switchedTab = prevActiveIdRef.current !== activeId;
    prevActiveIdRef.current = activeId;
    if (editingUrlRef.current) return;
    if (switchedTab) {
      const saved = getUrlDraft(activeId);
      if (saved) {
        setUrlDraft(saved);
        return;
      }
    }
    // Simple on purpose: only ever actively BLANK the field for the two
    // clear, stable states (home/settings). For every other update,
    // either it's a real, usable URL (show it) or it's some transient
    // in-between value the backend reports mid-navigation (about:blank,
    // the sentinel URLs, empty) — and for those, just don't touch
    // urlDraft at all, leave whatever's already showing exactly as is.
    // Trying to actively chase down and blank every transient value was
    // the actual bug — this only ever adds text, never removes it, except
    // for the two real "should be blank" cases.
    if (isHome || isSettings) {
      setUrlDraft("");
      return;
    }
    const url = activeTab?.url ?? "";
    if (!url || url === HOME_URL || url === SETTINGS_URL || url === "about:blank") return;
    setUrlDraft(url);
  }, [activeId, activeTab?.url, isHome]);

  const secondaryIsHome = secondaryTab?.isHome ?? false;
  const secondaryIsSettings = secondaryTab?.isSettings ?? false;

  // homeUrlDraft/secondaryHomeUrlDraft (the Start page's own centered
  // search bar — separate field from the header address bar above) are
  // single, lifted pieces of state shared by whichever Home tab happens
  // to be showing, so on their own a half-typed search silently followed
  // you to a DIFFERENT Home tab instead of staying with the tab it was
  // typed into. Re-seeding from this tab's own stored draft (or blanking
  // if it never had one) every time the primary/secondary Home tab
  // actually changes is what keeps each Home tab's search box genuinely
  // its own.
  const prevHomeTabIdRef = useRef<string | null>(null);
  useEffect(() => {
    const tabId = isHome ? activeId : null;
    if (prevHomeTabIdRef.current === tabId) return;
    prevHomeTabIdRef.current = tabId;
    setHomeUrlDraft(tabId ? getHomeSearchDraft(tabId) : "");
  }, [activeId, isHome]);
  const prevSecondaryHomeTabIdRef = useRef<string | null>(null);
  useEffect(() => {
    const tabId = secondaryIsHome ? secondaryId : null;
    if (prevSecondaryHomeTabIdRef.current === tabId) return;
    prevSecondaryHomeTabIdRef.current = tabId;
    setSecondaryHomeUrlDraft(tabId ? getHomeSearchDraft(tabId) : "");
  }, [secondaryId, secondaryIsHome]);

  // Set true for the moment a dragged tab is "armed" to tear off (see
  // TabStrip.tsx's onDragArmedChange) — folded into the SAME visibility
  // effect below rather than a separate setVisible() call, specifically
  // so restoring it afterward always falls back to whatever isHome/
  // isSettings actually says at that moment, instead of a hardcoded
  // setVisible(true) that could wrongly re-show a native view over the
  // Start/Settings page if that's what's active by then.
  const [tabDragArmed, setTabDragArmed] = useState(false);
  useEffect(() => {
    if (secondaryId) {
      // In split view either half might be the only one that actually
      // needs a native page attached — the backend's own applySplitLayout
      // decides per side, this just needs to know whether ANY native
      // content is needed at all right now.
      const leftNeedsNative = !(isHome || isSettings);
      const rightNeedsNative = !(secondaryIsHome || secondaryIsSettings);
      setVisible(!tabDragArmed && (leftNeedsNative || rightNeedsNative));
    } else {
      setVisible(!tabDragArmed && !isHome && !isSettings);
    }
  }, [isHome, isSettings, secondaryId, secondaryIsHome, secondaryIsSettings, setVisible, tabDragArmed]);

  // chromeHidden is an explicit dependency here (not just relying on the
  // ResizeObserver alone) so bounds are force-recalculated the instant the
  // tab strip/toolbar mount or unmount — this is what was actually leaving
  // the toolbar visually covered by the native page after leaving
  // fullscreen: the observer *should* catch that layout change on its own,
  // but evidently didn't always.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      const inset = chromeHidden ? { top: 0, right: 0, bottom: 0, left: 0 } : { ...CONTENT_INSET };
      // No vertical-tabs-specific adjustment needed here anymore — the
      // sidebar is always a normal in-flow flex sibling now (see
      // VerticalTabsSidebar), so contentRef's own rect already starts
      // right past it, at whichever width (RAIL_WIDTH or SIDEBAR_WIDTH)
      // it's currently showing. Previously, hovering the unpinned rail
      // widened it WITHOUT reflowing layout (to avoid the page jumping on
      // every mouse-over), which meant this effect had to separately
      // widen the inset to keep the real browsed page's native view
      // (which always paints above this window's own DOM) from covering
      // the widened panel. That whole hover-expand path is gone, so is
      // this special case.
      const nextBounds = {
        x: Math.round(rect.x + inset.left),
        y: Math.round(rect.y + inset.top),
        width: Math.round(Math.max(0, rect.width - inset.left - inset.right)),
        height: Math.round(Math.max(0, rect.height - inset.top - inset.bottom)),
      };
      setBounds(nextBounds);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [setBounds, chromeHidden]);

  // Ctrl/Cmd+T — new tab.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        newTab();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newTab]);

  // F11 — ask Electron for real OS-level fullscreen (hides the taskbar
  // too). chromeHidden itself is ONLY ever set from the authoritative
  // onFullscreenChanged event below, never optimistically here — that's
  // what actually fixes it getting stuck: previously this flipped its own
  // local state immediately AND asked Electron to match, and if those two
  // ever disagreed (a slow transition, exiting via Escape/Alt-Tab/a Windows
  // snap gesture instead of F11, ...) the tab strip could stay hidden even
  // after the window left fullscreen. Now there's exactly one source of
  // truth: the real window state, however it changed.
  const toggleChrome = () => {
    setFullScreen(!chromeHidden);
    setTimeout(() => getIsFullscreen().then(setChromeHidden), 400);
  };
  const exitChrome = () => {
    setFullScreen(false);
    setTimeout(() => getIsFullscreen().then(setChromeHidden), 400);
  };

  useEffect(() => {
    return onFullscreenChanged((isFullscreen) => setChromeHidden(isFullscreen));
  }, [onFullscreenChanged]);

  // Belt-and-suspenders: also actively re-check on window focus (fires
  // reliably right after any fullscreen transition finishes) instead of
  // trusting the event alone — a missed enter/leave-full-screen event was
  // the likely cause of the tab strip staying stuck hidden after Escape.
  useEffect(() => {
    const resync = () => getIsFullscreen().then(setChromeHidden);
    window.addEventListener("focus", resync);
    return () => window.removeEventListener("focus", resync);
  }, [getIsFullscreen]);

  // Offered once, right after mount — session:getRecovery only ever
  // returns available:true for the primary window, after a detected crash,
  // when "continue where you left off" isn't already silently doing this
  // (see session-store.ts / main.ts's createWindow).
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.browserAPI?.session : undefined;
    if (!api) return;
    api.getRecovery().then((recovery) => {
      if (recovery.available) setSessionRestore({ tabCount: recovery.tabCount });
    });
  }, []);

  // Find-in-page result counter — only updates while the bar is open;
  // tabId filtering matters because a background tab can still fire
  // found-in-page from a stale in-flight search.
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.browserAPI?.tabs : undefined;
    if (!api) return;
    return api.onFoundInPage((result) => {
      if (result.tabId !== activeId) return;
      setFindBar((prev) =>
        prev
          ? { ...prev, matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal }
          : prev,
      );
    });
  }, [activeId]);

  // Right-click context menu — only meaningful for the active tab (a
  // Right-click on an image/link/selection inside a tab: opening the menu
  // is now entirely handled main-process-side (electron/main.ts's
  // showContextMenu calls straight into OverlayWindowManager.open — see
  // that function's own comment) — no IPC round trip to this window is
  // needed to open it, so there's nothing to listen for here anymore.
  // Same for closing: the overlay window's own blur/Escape handling (see
  // overlay-window.ts) covers it without any renderer-side "click
  // outside"/"scroll closes it" bookkeeping. What routes/index.tsx still
  // owns is only EXECUTING the action once one's picked — see the
  // browserAPI.overlay.onAction effect further down, alongside the same
  // handling for the profile popup.

  const closeFindBar = () => {
    window.browserAPI?.tabs.stopFindInPage();
    setFindBar(null);
  };
  // Ctrl+F while the bar is already open closes it again instead of just
  // re-focusing it — reads current state via the functional setState form
  // so this stays correct without needing findBar in a dependency array.
  // The page underneath can still be holding real OS keyboard focus even
  // though the find bar is what's visually on top when opening — reclaim
  // it for the chrome UI first, otherwise the input renders focused but
  // keystrokes past the very first one keep going to the page instead
  // (this was the actual cause of "only works with one letter").
  const toggleFindBar = () => {
    setFindBar((prev) => {
      if (prev) {
        window.browserAPI?.tabs.stopFindInPage();
        return null;
      }
      window.browserAPI?.tabs.focusChrome().then(() => findInputRef.current?.focus());
      return { query: "", matches: 0, activeMatchOrdinal: 0 };
    });
  };

  const autoSavedPillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.browserAPI?.passwords : undefined;
    if (!api) return;
    return api.onAutoSaved((info) => {
      setAutoSavedPill(info);
      if (autoSavedPillTimer.current) clearTimeout(autoSavedPillTimer.current);
      autoSavedPillTimer.current = setTimeout(() => setAutoSavedPill(null), 4000);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleChrome();
      } else if (e.key === "Escape" && chromeHidden) {
        exitChrome();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chromeHidden]);

  // Same two shortcuts, relayed from Electron when a real page (not our own
  // chrome UI) has keyboard focus — see onShortcutF11/onShortcutEscape in
  // use-window-controls.ts for why a plain keydown listener can't see these.
  useEffect(() => {
    const unsubF11 = onShortcutF11(() => toggleChrome());
    const unsubEsc = onShortcutEscape(() => {
      if (chromeHidden) {
        exitChrome();
        return;
      }
      setFindBar((prev) => {
        if (!prev) return prev;
        window.browserAPI?.tabs.stopFindInPage();
        return null;
      });
    });
    // Ctrl/Cmd+L — same relay reasoning. New tab/close tab/reload/tab-cycle
    // shortcuts (Ctrl+T/W/R/Tab) act directly on the TabManager in
    // main.ts and don't need anything here; only focusing this DOM input
    // can happen in the renderer.
    const unsubFocusUrlBar = onShortcutFocusUrlBar(() => {
      urlBarRef.current?.focus();
      urlBarRef.current?.select();
    });
    const unsubAddFavorite = onShortcutAddFavorite(() => starCurrentPage());
    const unsubFindInPage = onShortcutFindInPage(() => toggleFindBar());
    const unsubTabSearch = onShortcutTabSearch(() => {
      window.browserAPI?.overlay.open(
        "tabSearch",
        {
          tabs: tabsRef.current.map((t) => ({
            id: t.id,
            title: t.title,
            url: t.url,
            isHome: t.isHome,
            isSettings: t.isSettings,
          })),
        },
        { top: 0, left: 0, right: 0, bottom: 0, placement: "cover" },
      );
    });
    const unsubOpenPasswordSettings = onShortcutOpenPasswordSettings(() =>
      goToSettings("passwords"),
    );
    return () => {
      unsubF11();
      unsubEsc();
      unsubFocusUrlBar();
      unsubAddFavorite();
      unsubFindInPage();
      unsubTabSearch();
      unsubOpenPasswordSettings();
    };
  }, [chromeHidden]);

  // Toasts are gone entirely per Juri — these are now no-ops, kept only so
  // the many call sites below don't need to change one by one.
  const notifySuccess = (_msg: string) => {};
  const notifyError = (_msg: string) => {};
  const notify = (_msg: string) => {};

  const openSlot = (index: number) => {
    const existing = bookmarks[index];
    window.browserAPI?.overlay.open(
      "bookmark",
      { slot: index, label: existing?.label ?? "", url: existing?.url ?? "" },
      { top: 0, left: 0, right: 0, bottom: 0, placement: "cover" },
    );
  };

  const remove = (index: number) => {
    setBookmarks((prev) => prev.map((b, i) => (i === index ? null : b)));
    notify("Bookmark removed");
  };

  const [starFlash, setStarFlash] = useState(false);
  const starCurrentPage = () => {
    if (isHome) {
      addHeaderFavorite("Home", HOME_URL);
    } else if (activeTab) {
      addHeaderFavorite(activeTab.title || activeTab.url, activeTab.url);
    } else {
      return;
    }
    setStarFlash(true);
    setTimeout(() => setStarFlash(false), 350);
  };

  // Brief "yep, that registered" confirmation for the New Identity button —
  // requestNewIdentity() itself has no visible effect for a second or two
  // (new circuits only apply to FUTURE connections), so without this the
  // click looked like it did nothing.
  const [identityRequested, setIdentityRequested] = useState(false);
  const requestNewTorIdentity = () => {
    void torNewIdentity();
    setIdentityRequested(true);
    setTimeout(() => setIdentityRequested(false), 1500);
  };

  const copyUrl = async () => {
    if (isHome) {
      notifyError("Nothing to copy here");
      return;
    }
    try {
      // Was navigator.clipboard.writeText() — the chrome UI's own
      // webContents doesn't reliably have clipboard-write permission/focus
      // for the Clipboard API (Electron's permission handling doesn't
      // auto-grant it the way a real user-facing page origin would), which
      // is exactly why every other copy-to-clipboard action in this app
      // (right-click "Copy link", "Copy image") already goes through the
      // native electron `clipboard` module over IPC instead. Routing the
      // address-bar button through that same links:copy handler is what
      // actually fixes it, not just makes it consistent.
      const url = activeTab?.url ?? "";
      if (window.browserAPI?.links) {
        await window.browserAPI.links.copy(url);
      } else {
        await navigator.clipboard.writeText(url);
      }
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1400);
    } catch {
      notifyError("Could not copy URL");
    }
  };

  const submitUrl = (raw: string) => {
    const target = parseUrlBarInput(raw, isTorWindow);
    if (!target) {
      notifyError("Enter a valid URL");
      return;
    }
    // Set right away instead of waiting for activeTab.url to catch up via
    // the backend round trip — without this there's a real gap where the
    // tab is no longer "home" but hasn't reported the new URL yet either,
    // during which the address bar had nothing correct to show at all.
    if (target !== HOME_URL) setUrlDraft(target);
    // A submitted value isn't a pending draft anymore — it's about to
    // become the real URL, so drop whatever was stored (this fires for
    // both the header bar's Enter and the Start page's own search bar)
    // rather than let it linger and get wrongly restored on some later
    // tab switch.
    clearAllDraftsForTab(activeId);
    if (activeId) navigate(activeId, target);
    else newTab(target === HOME_URL ? undefined : target);
    setEditingUrl(false);
    // setEditingUrl alone doesn't drop real browser focus — the ring is
    // CSS focus-within, which tracks actual DOM focus, not this state.
    // Without this, the ring stayed lit after Enter even though nothing
    // was being edited anymore, since the input itself never actually
    // lost focus.
    urlBarRef.current?.blur();
  };

  // Every place that closes a tab routes through here instead of calling
  // closeTab directly, so the "Recently closed" list in the tabs-menu
  // dropdown stays accurate no matter which UI triggered the close (tab
  // strip, vertical sidebar, group deletion, ...). The New Tab/Settings
  // pages are skipped — reopening either of those isn't a meaningful
  // action, so they'd just be clutter in the list.
  const handleCloseTab = (id: string) => {
    const closed = tabs.find((t) => t.id === id);
    if (closed && !closed.isHome && !closed.isSettings) {
      setRecentlyClosed((prev) =>
        [
          {
            id: closed.id,
            title: closed.title,
            url: closed.url,
            isHome: closed.isHome,
            isSettings: closed.isSettings,
            closedAt: Date.now(),
          },
          ...prev,
        ].slice(0, 20),
      );
    }
    clearAllDraftsForTab(id);
    closeTab(id);
  };

  const openBookmark = (url: string, targetId: string | null = activeId) => {
    if (targetId === activeId && url !== HOME_URL) setUrlDraft(url);
    clearAllDraftsForTab(targetId);
    if (targetId) navigate(targetId, url);
    else newTab(url);
  };
  openBookmarkRef.current = openBookmark;

  const openQuecksilverWebsite = () => {
    if (activeId) navigate(activeId, "https://quecksilver.ch");
    else newTab("https://quecksilver.ch");
  };

  // Always a new tab, never navigating whatever the person was already
  // looking at away from under them — true for every entry point (the
  // toolbar's Settings icon, the Edit icon, the "password saved" pill,
  // ...), since they all route through this one function.
  const goToSettings = (section?: string) => {
    if (section) setPendingSettingsAnchor(section);
    newTab(SETTINGS_URL);
  };

  // The backend's own splitRatio (0..1, left side's share) is kept in sync
  // via the ResizablePanel's onResize below — using the real
  // react-resizable-panels library (same ResizableHandle design as
  // QueckSilver AI's code workspace) instead of a hand-rolled drag handler.

  // Toggles split view. Entering: picks any other open tab (the one right
  // after the active one in tab order, wrapping to the one before if
  // active is last) — if the active tab is the only one open, a fresh
  // home tab is created first so there's always something valid to put on
  // the right.
  const toggleSplit = async () => {
    if (secondaryId) {
      exitSplit();
      return;
    }
    const others = tabs.filter((t) => t.id !== activeId);
    if (others.length > 0) {
      const currentIndex = tabs.findIndex((t) => t.id === activeId);
      const after = tabs[currentIndex + 1];
      const pick = (after && after.id !== activeId ? after : others[0])!.id;
      enterSplit(pick);
    } else {
      const newId = await newTab();
      // newTab() also switches to it, making it the new active tab — swap
      // back so the ORIGINAL tab stays active (left) and the fresh one
      // becomes secondary (right), matching what the person expects when
      // they had one tab and hit split.
      if (newId && activeId) {
        switchTab(activeId);
        enterSplit(newId);
      }
    }
  };

  return (
    <div
      className={`flex h-screen w-screen flex-col overflow-hidden bg-background font-sans ${chromeHidden ? "" : "rounded-[10px]"}`}
    >
      {/* Header — tab strip + toolbar (+ favorites bar, if shown) — always
          spans the full window width, edge to edge, and sits above the
          vertical-tabs sidebar rather than beside it. That way the sidebar
          (pinned or unpinned) never covers the back/forward buttons or the
          search bar, and those never need to shift to make room for it —
          only the row below (the sidebar + page content) does. */}
      {!chromeHidden && (
        <TabStrip
          tabs={tabs}
          groups={groups}
          activeId={activeId}
          loadingTabIds={loadingHomeTabs}
          onSelect={(id) => switchTab(id)}
          onClose={(id) => handleCloseTab(id)}
          onToggleMute={(id) => window.browserAPI?.tabs.toggleMute(id)}
          onReorder={(newOrder) => reorderTabs(newOrder)}
          onDetachToNewWindow={(id, screenX, screenY) => detachToWindow(id, screenX, screenY)}
          onDragArmedChange={setTabDragArmed}
          onNewTab={() => newTab()}
          onOpenTabsMenu={(rect) =>
            window.browserAPI?.overlay.open(
              "tabsMenu",
              {
                verticalTabsEnabled,
                tabs: tabs.map((t) => ({
                  id: t.id,
                  title: t.title,
                  url: t.url,
                  isHome: t.isHome,
                  isSettings: t.isSettings,
                  isActive: t.id === activeId,
                  openedAt: t.openedAt,
                })),
                recentlyClosed,
                controlCenter: controlCenterSettings,
                consoleErrorTotal,
                trackerCountForActiveTab,
                currentSiteSafety,
                bandwidthForActiveTab,
                resourceUsageForActiveTab,
                customCssForActiveTab,
                pageMetadataResult,
                requestLogResult,
                cookiesResult,
                indexedDbResult,
                serviceWorkerResult,
                requestMocksResult,
              },
              rect,
            )
          }
          verticalMode={verticalTabsEnabled}
          onToggleGroupCollapse={(groupId) => {
            const group = groups.find((g) => g.id === groupId);
            if (group) setGroupCollapsed(groupId, !group.collapsed);
          }}
          onCreateGroup={(tabId) => {
            window.browserAPI?.overlay.open(
              "groupDialog",
              { tabId, defaultColor: TAB_GROUP_COLORS[groups.length % TAB_GROUP_COLORS.length]! },
              { top: 0, left: 0, right: 0, bottom: 0, placement: "cover" },
            );
          }}
          onAddToGroup={(tabId, groupId) => setTabGroup(tabId, groupId)}
          onRemoveFromGroup={(tabId) => setTabGroup(tabId, null)}
          onDeleteGroup={(groupId) => {
            for (const t of tabs) if (t.groupId === groupId) handleCloseTab(t.id);
          }}
          onUngroup={(groupId) => {
            for (const t of tabs) if (t.groupId === groupId) setTabGroup(t.id, null);
          }}
          hasNativeControls={hasNativeControls}
          isMaximized={isMaximized}
          onMinimize={() => minimize()}
          onToggleMaximize={() => toggleMaximize()}
          onCloseWindow={() => closeWindow()}
        />
      )}

      {/* Toolbar — back/forward/reload, url bar, right-side icons + sign in.
          Hidden in fullscreen (F11) — only the page itself shows then. */}
      {!chromeHidden && (
        <div className="relative flex shrink-0 items-center gap-2.5 bg-background px-3 py-[6px]">
          <button
            onClick={() => activeId && goBack(activeId)}
            disabled={!activeTab?.canGoBack}
            className="flex h-[28px] w-[28px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-30"
          >
            <ArrowLeft className="h-[17px] w-[17px]" />
          </button>
          <button
            onClick={() => activeId && goForward(activeId)}
            disabled={!activeTab?.canGoForward}
            className="flex h-[28px] w-[28px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-30"
          >
            <ArrowRight className="h-[17px] w-[17px]" />
          </button>
          <button
            onClick={() => activeId && reload(activeId)}
            className="flex h-[28px] w-[28px] items-center justify-center rounded-lg text-foreground transition-colors hover:bg-foreground/5"
          >
            <RotateCw className="h-4 w-4" />
          </button>

          <div className="relative max-w-[900px] flex-1">
            <div
              className={`flex items-center gap-2.5 rounded-full py-[4px] pl-4 pr-2.5 transition-shadow ${editingUrl ? "ring-2 ring-[var(--brand)]" : ""}`}
              style={{ background: "var(--chrome-field)" }}
            >
              {activeTab?.isHome ? (
                // On the Start page there's no URL to copy, so this slot
                // becomes a search-engine picker instead — the icon of
                // whichever engine currently handles the Start page's search
                // bar, with a dropdown to switch it right there instead of
                // needing a trip to Settings.
                <SearchEngineChooser engine={engine} onChange={setEngine} variant="inline" />
              ) : null}
              {!activeTab?.isHome ? (
                <button
                  onClick={copyUrl}
                  aria-label="Copy URL"
                  className={`shrink-0 ${urlCopied ? "text-green-600" : "text-muted-foreground"}`}
                >
                  {urlCopied ? (
                    <Check className="h-[14px] w-[14px]" strokeWidth={2.5} />
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  )}
                </button>
              ) : null}
              <input
                ref={urlBarRef}
                value={urlDraft}
                onFocus={() => setEditingUrl(true)}
                onMouseDown={(e) => {
                  // Fighting the browser's native "click places the cursor at
                  // this point" behavior head-on (preventDefault on mouseup)
                  // turned out unreliable — the native cursor placement can
                  // still win the race depending on timing. Letting it run
                  // first, then overriding with select-all on the very next
                  // frame, consistently wins instead: by then the field is
                  // definitely focused and the native placement has already
                  // happened, so our selection is the last word.
                  if (document.activeElement !== e.currentTarget) {
                    const el = e.currentTarget;
                    requestAnimationFrame(() => el.select());
                  }
                }}
                onBlur={(e) => {
                  setEditingUrl(false);
                  // Deliberately does NOT revert unsubmitted typed text back
                  // to the real current URL anymore — clicking away used to
                  // discard whatever was typed, which was the actual
                  // complaint (people expect the draft to still be sitting
                  // there if they click back in, same as most other browsers'
                  // combined bars). The sync effect below (keyed off
                  // activeTab?.url / isHome, and itself gated on
                  // !editingUrlRef.current) still overwrites this draft the
                  // moment a REAL navigation actually lands, so a stale typed
                  // value never sticks around once the page it was describing
                  // has changed out from under it.
                  //
                  // select() on focus leaves the selection visually lingering
                  // (as a grey highlight) even after the input loses focus —
                  // collapsing it explicitly here is what actually clears it.
                  e.target.setSelectionRange(0, 0);
                }}
                onChange={(e) => {
                  // The DOM value here already reflects native browser
                  // behavior for a keystroke landing on a selected range (the
                  // highlighted suggestion tail gets replaced automatically),
                  // so raw below is always exactly what the person now
                  // intends — no need to reconstruct it by hand from
                  // selectionStart/key (an earlier version tried that in
                  // onKeyDown, with a preventDefault + manual rebuild, and got
                  // the very first character wrong somehow — reading it
                  // straight from the browser's own already-correct
                  // computation here avoids that class of bug entirely, by
                  // construction).
                  //
                  // The completion is also applied HERE, synchronously, in
                  // this same handler — rather than in the separate effect
                  // below reacting to a LATER render — specifically so
                  // "replace the selection with what was typed" and "extend
                  // it back out with a new completion" land in the exact same
                  // React render/paint instead of two consecutive ones. Two
                  // renders for one keystroke is what was still reading as
                  // flicker even once the lookup itself became instant; this
                  // is what actually collapses it to one.
                  const raw = e.target.value;
                  const dismissed = dismissedAtLengthRef.current;
                  const eligible =
                    editingUrl &&
                    raw.trim().length >= 3 &&
                    (dismissed === null || raw.length >= dismissed + 2);
                  const match = eligible ? computeBestMatch(raw) : null;
                  if (match && match.length > raw.length) {
                    if (dismissed !== null) dismissedAtLengthRef.current = null;
                    pendingCompletionSelectionRef.current = {
                      start: raw.length,
                      end: match.length,
                    };
                    programmaticUrlChangeRef.current = true; // the effect below would otherwise redundantly redo this exact lookup on its next run
                    setUrlDraft(match);
                    setUrlDraftStored(activeId, match);
                    return;
                  }
                  pendingCompletionSelectionRef.current = null;
                  programmaticUrlChangeRef.current = false;
                  setUrlDraft(raw);
                  setUrlDraftStored(activeId, raw);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitUrl(urlDraft);
                  else if (e.key === "Tab") {
                    // Without this, Tab did what Tab always does in a plain
                    // <input> — move focus to the NEXT focusable element
                    // entirely, which fires this same field's onBlur, which
                    // resets urlDraft back to the real current URL. That's
                    // exactly the "URL gets cleared and the bar loses focus"
                    // symptom — Tab was never actually being handled as an
                    // "accept the suggestion" key at all, it was just falling
                    // through to the browser's own unrelated default. This
                    // intercepts it: collapse the selection to the end
                    // (accepting the completed URL as plain typed text,
                    // cursor after it) and keep focus right where it is,
                    // same as a real address bar's Tab behavior.
                    e.preventDefault();
                    const el = e.currentTarget;
                    el.setSelectionRange(el.value.length, el.value.length);
                  } else if (e.key === "Backspace" || e.key === "Delete") {
                    const el = e.currentTarget;
                    // Remembered as a LENGTH, not the exact string — so typing
                    // past it later (2+ genuinely new characters) is what
                    // re-enables suggestions again, rather than just "any
                    // different string at all" (which a single further
                    // keystroke already always produces, defeating the point).
                    // Whatever's left right after this deletion — whether it
                    // came from eating an active suggestion selection in one
                    // press, or an ordinary single-character backspace with no
                    // selection — counts as the dismiss point.
                    const remainingLength =
                      el.selectionStart !== el.selectionEnd
                        ? (el.selectionStart ?? 0)
                        : Math.max(0, el.value.length - 1);
                    dismissedAtLengthRef.current = remainingLength;
                  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    // A single printable character typed while a suggestion is
                    // currently selected — handled entirely here, synchronously,
                    // in one step, instead of letting the browser replace the
                    // selection natively (one repaint) and then reacting to
                    // that change afterward in the effect below (a second,
                    // separate repaint). Two repaints for what's conceptually
                    // one keystroke is exactly what read as flicker.
                    const el = e.currentTarget;
                    if (el.selectionStart === null || el.selectionStart === el.selectionEnd) return; // no active suggestion — let normal typing happen
                    e.preventDefault();
                    const typedSoFar = el.value.slice(0, el.selectionStart) + e.key;
                    const match = computeBestMatch(typedSoFar);
                    const finalValue =
                      match && match.length > typedSoFar.length ? match : typedSoFar;
                    if (finalValue === urlDraft) {
                      // The typed character happened to be exactly the first
                      // character of what was already highlighted — e.g.
                      // typing "g" while "guessr.com" (which starts with "g")
                      // is selected on top of "geo". The resulting completed
                      // string is then IDENTICAL to what urlDraft already is,
                      // so calling setUrlDraft with that same value is a no-op
                      // React bails out of (same reference/value in, nothing
                      // to re-render) — which meant the useLayoutEffect that
                      // normally reapplies the selection never ran at all, and
                      // the keystroke looked completely swallowed: exactly the
                      // "can't type the suggestion's own first letter" bug.
                      // Since the value genuinely isn't changing here, React's
                      // controlled-input reconciliation has nothing to
                      // "correct" on the next render either — so, uniquely in
                      // this one case, it's actually safe to set the selection
                      // directly, no pending/layout-effect handoff needed.
                      el.setSelectionRange(typedSoFar.length, finalValue.length);
                      return;
                    }
                    pendingCompletionSelectionRef.current =
                      match && match.length > typedSoFar.length
                        ? { start: typedSoFar.length, end: finalValue.length }
                        : null;
                    programmaticUrlChangeRef.current = true;
                    setUrlDraft(finalValue);
                    setUrlDraftStored(activeId, finalValue);
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                placeholder="Search or enter web address"
                // Chromium's own native field-autofill (remembers previously
                // typed values for this exact input, independent of anything
                // above) was competing with the custom completion logic here —
                // its own suggestion behavior doesn't highlight only the
                // completed portion or land the caret in the right spot, so
                // depending on timing it could visibly override what this
                // component was trying to do. This is a real browser-security-
                // relevant field too (it's literally the address bar), so
                // disabling the browser's own guess-based autofill for it is
                // the right call regardless.
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {activeTab?.isHome && isLikelyDirectUrl(urlDraft) ? (
                // Once what's typed on the Start page's header bar reads as an
                // actual address rather than a search term, show that site's
                // favicon right after the typed text — a quick visual "yes,
                // this is going to open a real page" confirmation before Enter
                // is even pressed.
                <FavIcon url={urlDraft.trim()} label={urlDraft.trim()} size="h-4 w-4" />
              ) : null}
              {isTorWindow && (
                <button
                  onClick={requestNewTorIdentity}
                  aria-label="New Tor identity"
                  title={
                    identityRequested
                      ? "New identity requested"
                      : torStatus.state === "ready"
                        ? "New Identity, clears this window's session and gets fresh circuits"
                        : "Connecting to Tor…"
                  }
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${identityRequested ? "text-[#8a5fc4]" : "text-[#8a5fc4] hover:bg-[#8a5fc4]/10"}`}
                >
                  {identityRequested ? (
                    <Check className="h-[16px] w-[16px]" strokeWidth={2} />
                  ) : (
                    <TorOnionLogo className="h-[21px] w-[21px]" strokeWidth={1.5} />
                  )}
                </button>
              )}
              <button
                onClick={starCurrentPage}
                aria-label="Add to favorites"
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-foreground/10 ${starFlash ? "text-foreground" : "text-muted-foreground"}`}
              >
                <Star
                  className="h-[17px] w-[17px]"
                  strokeWidth={1.5}
                  fill={starFlash ? "currentColor" : "none"}
                />
              </button>
            </div>
          </div>

          <div className="ml-1.5 flex items-center">
            {/* Same slot as the auto-save confirmation below — replaces the
              icons + profile pill (not the whole toolbar, and never covers
              the search bar) while any of these is showing, then reverts
              back. Priority: find bar (an open interaction) > session
              restore offer (a decision) > password-saved (a passing
              status). */}
            {findBar ? (
              <div className="flex items-center gap-2 rounded-full border border-border bg-white px-3.5 py-1.5 text-[13px] text-foreground shadow-sm">
                <input
                  ref={findInputRef}
                  value={findBar.query}
                  onChange={(e) => {
                    const query = e.target.value;
                    setFindBar((prev) => (prev ? { ...prev, query } : prev));
                    window.browserAPI?.tabs.findInPage(query, true, false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      closeFindBar();
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      window.browserAPI?.tabs.findInPage(findBar.query, !e.shiftKey, true);
                    }
                  }}
                  placeholder="Find on page"
                  className="w-40 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {findBar.matches > 0
                    ? `${findBar.activeMatchOrdinal}/${findBar.matches}`
                    : findBar.query
                      ? "0/0"
                      : ""}
                </span>
                <button
                  onClick={() => {
                    // Optimistic counter update — the real highlight/scroll
                    // still comes from the IPC round trip to Electron's
                    // native findInPage, which has an inherent bit of
                    // latency; updating the visible count immediately at
                    // least makes the click itself feel instant instead of
                    // waiting on that round trip before anything changes.
                    setFindBar((prev) => {
                      if (!prev || prev.matches === 0) return prev;
                      const next =
                        prev.activeMatchOrdinal <= 1 ? prev.matches : prev.activeMatchOrdinal - 1;
                      return { ...prev, activeMatchOrdinal: next };
                    });
                    window.browserAPI?.tabs.findInPage(findBar.query, false, true);
                  }}
                  aria-label="Previous match"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-foreground/10"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setFindBar((prev) => {
                      if (!prev || prev.matches === 0) return prev;
                      const next =
                        prev.activeMatchOrdinal >= prev.matches ? 1 : prev.activeMatchOrdinal + 1;
                      return { ...prev, activeMatchOrdinal: next };
                    });
                    window.browserAPI?.tabs.findInPage(findBar.query, true, true);
                  }}
                  aria-label="Next match"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-foreground/10"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  onClick={closeFindBar}
                  aria-label="Close find bar"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-foreground/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : sessionRestore ? (
              <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-[13px] font-semibold text-foreground">
                <span>
                  Restore {sessionRestore.tabCount} tab{sessionRestore.tabCount === 1 ? "" : "s"}{" "}
                  from last session?
                </span>
                <button
                  onClick={() => {
                    window.browserAPI?.session.restoreAccepted();
                    setSessionRestore(null);
                  }}
                  className="rounded-full bg-foreground px-2.5 py-0.5 text-background transition-colors hover:opacity-80"
                >
                  Restore
                </button>
                <button
                  onClick={() => {
                    window.browserAPI?.session.restoreDismissed();
                    setSessionRestore(null);
                  }}
                  className="rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:bg-foreground/10"
                >
                  Dismiss
                </button>
              </div>
            ) : updateReady ? (
              <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-[13px] font-semibold text-foreground">
                <span>Update ready</span>
                <button
                  onClick={() => window.browserAPI?.appUpdate.install()}
                  className="rounded-full bg-foreground px-2.5 py-0.5 text-background transition-colors hover:opacity-80"
                >
                  Restart
                </button>
                <button
                  onClick={() => setUpdateReady(false)}
                  className="rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:bg-foreground/10"
                >
                  Later
                </button>
              </div>
            ) : autoSavedPill ? (
              <button
                onClick={() => {
                  setAutoSavedPill(null);
                  goToSettings("passwords");
                }}
                className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted/70"
              >
                <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
                Password for {autoSavedPill.url} saved
              </button>
            ) : (
              <>
                <ToolbarActionIcons
                  style={toolbarStyle}
                  onOpenDownloads={openDownloadsPopup}
                  actions={toolbarIconOrder.map((id) => {
                    const defs: Record<ToolbarIconId, ToolbarAction> = {
                      edit: {
                        id: "edit",
                        icon: Edit3,
                        label: "Edit",
                        onClick: () => goToSettings("favorites"),
                      },
                      settings: {
                        id: "settings",
                        icon: Settings,
                        label: "Settings",
                        onClick: () => goToSettings(),
                      },
                      download: {
                        id: "download",
                        icon: Download,
                        label: "Downloads",
                        onClick: openDownloadsPopup,
                        busy: activeDownloadCount > 0,
                        justDone: justCompletedDownload,
                      },
                      split: {
                        id: "split",
                        icon: Columns2,
                        label: "Split",
                        onClick: toggleSplit,
                        active: Boolean(secondaryId),
                      },
                      pip: {
                        id: "pip",
                        icon: PictureInPicture2,
                        label: "Picture-in-Picture",
                        onClick: () => void togglePiP(),
                      },
                    };
                    return defs[id];
                  })}
                  draggedId={draggedIcon}
                  onDragStart={setDraggedIcon}
                  onDropOn={(id) => {
                    if (draggedIcon) moveToolbarIcon(draggedIcon, id);
                    setDraggedIcon(null);
                  }}
                  onDragEnd={() => setDraggedIcon(null)}
                />
                {authPending ? (
                  <button
                    onClick={() => cancelLogin()}
                    aria-label="Cancel sign in"
                    className="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-full border-4 border-white bg-card shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                  >
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ) : isGuest ? (
                  <button
                    onClick={openProfilePopup}
                    aria-label={
                      isTorWindow
                        ? "Tor"
                        : activeIdentity.windowMode === "incognito"
                          ? "Incognito"
                          : "Guest"
                    }
                    className="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-full border-4 border-white bg-card shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                  >
                    {isTorWindow ? (
                      <TorOnionLogo className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
                    ) : activeIdentity.windowMode === "incognito" ? (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                ) : activeProfile ? (
                  <button
                    onClick={openProfilePopup}
                    aria-label={
                      activeProfile.kind === "quecksilver" && activeProfile.email
                        ? nameFromEmail(activeProfile.email)
                        : activeProfile.name
                    }
                    className="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-full border-4 border-white text-[11px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                    style={{
                      background:
                        activeProfile.kind === "quecksilver" ? "var(--brand)" : "hsl(240 4% 46%)",
                    }}
                  >
                    {(activeProfile.kind === "quecksilver"
                      ? activeProfile.email
                      : activeProfile.name
                    )
                      ?.charAt(0)
                      .toUpperCase() ?? "?"}
                  </button>
                ) : (
                  <button
                    onClick={openProfilePopup}
                    disabled={!isElectron}
                    aria-label="Sign in"
                    className="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-full border-4 border-white bg-card shadow-[0_1px_3px_rgba(0,0,0,0.15)] disabled:opacity-50"
                  >
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
                {/* Chat pill — same pill design as the profile button (bg-card,
                  h-8, matching shadow). Opens/closes the Zora sidebar
                  (routes/index.tsx's zoraOpen state, rendered as a flex
                  sibling to contentRef further down — see the comment
                  there for why it has to live outside contentRef). */}
                <button
                  onClick={() => setZoraOpen((v) => !v)}
                  aria-pressed={zoraOpen}
                  className={`ml-2 flex h-8 items-center gap-1.5 rounded-full pl-2 pr-3.5 text-[13px] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.15)] ${
                    zoraOpen ? "bg-[var(--brand)] text-white" : "bg-card text-foreground"
                  }`}
                >
                  <QueckSilverLogo className="h-4 w-4" style={{ color: zoraOpen ? "white" : "var(--brand)" }} />
                  Chat
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Row below the header: the vertical-tabs sidebar (if enabled) plus
          the page content, side by side. The sidebar is a normal in-flow
          flex sibling now (always either RAIL_WIDTH or SIDEBAR_WIDTH
          wide — see VerticalTabsSidebar), so this box no longer needs to
          be `relative` for anything to position against. */}
      <div
        className={`flex min-h-0 flex-1 ${!chromeHidden && verticalTabsEnabled ? "flex-row" : "flex-col"} overflow-hidden`}
      >
        {!chromeHidden && verticalTabsEnabled && (
          <VerticalTabsSidebar
            tabs={tabs}
            activeId={activeId}
            loadingTabIds={loadingHomeTabs}
            onSelect={(id) => switchTab(id)}
            onClose={(id) => handleCloseTab(id)}
            onNewTab={() => newTab()}
            open={verticalTabsOpen}
            onToggleOpen={() => setVerticalTabsOpen(!verticalTabsOpen)}
            showFavoritesDivider={
              !chromeHidden && !isGuest && headerFavoritesBarVisible && headerFavorites.length > 0
            }
            onOpenTabsMenu={(rect) =>
              window.browserAPI?.overlay.open(
                "tabsMenu",
                {
                  verticalTabsEnabled,
                  tabs: tabs.map((t) => ({
                    id: t.id,
                    title: t.title,
                    url: t.url,
                    isHome: t.isHome,
                    isSettings: t.isSettings,
                    isActive: t.id === activeId,
                    openedAt: t.openedAt,
                  })),
                  recentlyClosed,
                  controlCenter: controlCenterSettings,
                  consoleErrorTotal,
                  trackerCountForActiveTab,
                  currentSiteSafety,
                  bandwidthForActiveTab,
                  resourceUsageForActiveTab,
                  customCssForActiveTab,
                  pageMetadataResult,
                  requestLogResult,
                  cookiesResult,
                  indexedDbResult,
                  serviceWorkerResult,
                  requestMocksResult,
                },
                rect,
              )
            }
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header favorites bar — separate from the 5 home-page slots.
              Toggleable from Settings (next to "Add favorite") independent
              of the favorites list itself — hiding the bar doesn't touch
              any saved favorite. Lives INSIDE the content column (not as
              a full-width row above the sidebar+content split) on
              purpose: with vertical tabs on, this row needs to sit
              beside the sidebar the same way the page content does, so
              the sidebar (pinned, or unpinned-and-hover-expanded) blocks
              it exactly like it blocks the page instead of floating
              above it across the sidebar's own column too. */}
          {!chromeHidden && !isGuest && headerFavoritesBarVisible && headerFavorites.length > 0 && (
            <div className="flex shrink-0 items-center bg-background px-3 pb-1 pt-0">
              <HeaderFavoritesBar
                favorites={headerFavorites}
                onOpen={openBookmark}
                onOpenFolder={(folder, e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  window.browserAPI?.overlay.open(
                    "favoriteFolder",
                    {
                      folderId: folder.id,
                      label: folder.label,
                      items: headerFavorites
                        .filter((f) => f.parentId === folder.id)
                        .map((f) => ({
                          id: f.id,
                          label: f.label,
                          url: f.url,
                          iconOnly: Boolean(f.iconOnly),
                        })),
                    },
                    { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
                  );
                }}
                onReorder={reorderHeaderFavorites}
                onAddToFolder={addHeaderFavoriteToFolder}
                onRemoveFromFolder={removeHeaderFavoriteFromFolder}
                onContextMenu={(f, e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  window.browserAPI?.overlay.open(
                    "favoriteContextMenu",
                    {
                      id: f.id,
                      label: f.label,
                      url: f.url,
                      iconOnly: Boolean(f.iconOnly),
                      inFolder: Boolean(f.parentId),
                    },
                    { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
                  );
                }}
                renderIcon={(f) =>
                  f.isFolder ? (
                    <Folder className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <FavIcon url={f.url} label={f.label} size="h-4 w-4" />
                  )
                }
              />
            </div>
          )}

          {/* Content — flush with the real window edges (no gap) so Windows'
          automatic DWM corner-rounding on this frameless window actually
          applies to it, same as Edge/Chrome do. A gap here would put native
          page content away from the true window boundary and the OS
          rounding would have nothing to clip. In fullscreen this is the
          ONLY thing visible — chrome above is hidden entirely.
          The thin top border is Start-page-only: real browsed pages and
          Settings sit flush against the toolbar with no seam (matching
          Chrome/Edge), but the Start page's white background is the same
          white as the toolbar above it, so without a hairline the two
          would visually merge into one blank area — same reasoning as
          --chrome-border everywhere else in the toolbar. */}
          <div
            ref={pageScrollRef}
            className="custom-scrollbar relative flex-1 overflow-y-auto bg-white"
            style={
              isHome && !secondaryId ? { borderTop: "1px solid var(--chrome-border)" } : undefined
            }
          >
            <div className="flex h-full flex-col bg-white">
              {/* Row wrapper: content on the left (shrinks via flex-1),
                  Zora sidebar as a fixed-width sibling on the right when
                  open. contentRef's own rect (used by the ResizeObserver
                  above to report native content bounds to the backend)
                  now only covers its own flex-1 share, so opening the
                  sidebar automatically shrinks where the real browsed
                  page renders — no separate bounds-adjustment IPC call
                  needed, the existing ResizeObserver mechanism already
                  reacts to any layout change here. Zora has to be a
                  sibling OUTSIDE contentRef, not inside it — a real
                  browsed page's native WebContentsView always paints
                  above this window's own DOM content regardless of
                  z-index, so if the sidebar were inside contentRef's
                  bounds it would just be invisible, covered by the page. */}
              <div className="relative flex h-full w-full flex-1 overflow-hidden">
                <div ref={contentRef} className="relative flex h-full flex-1 overflow-hidden">
                {secondaryId ? (
                  <ResizablePanelGroup orientation="horizontal">
                    <ResizablePanel
                      defaultSize={50}
                      minSize={15}
                      onResize={(size) => setSplitRatio(size.asPercentage / 100)}
                    >
                      {/* key={activeId} — Ctrl+wheel/pinch zoom (usePageZoom,
                      inside ZoomedContent) is meant to be transient and
                      per-tab, same as a real browsed tab's own independent
                      zoom (see ZoomedContent's own comment). Without a key
                      tied to the tab, this component stays mounted across
                      tab switches (only its children swap), so the zoom
                      factor state carried over from whichever tab was
                      zoomed last — visually indistinguishable from the
                      persisted "Default page zoom" setting even though it
                      was never actually written there. Remounting on
                      activeId change is what actually resets it per tab. */}
                      <ZoomedContent
                        key={activeId}
                        className="relative flex h-full flex-col overflow-hidden"
                      >
                        {isHome && !isHomeLoading && (
                          <HomeContent
                            urlDraft={homeUrlDraft}
                            onUrlDraftChange={(value) => {
                              setHomeUrlDraft(value);
                              setHomeSearchDraftStored(activeId, value);
                            }}
                            onSubmit={submitUrl}
                            bookmarks={bookmarks}
                            onOpenBookmark={(url) => openBookmark(url)}
                            onOpenSlot={openSlot}
                            onRemoveSlot={remove}
                            privacyMode={homePrivacyMode}
                            searchEngineId={engine}
                            onionize={onionize}
                            onToggleOnionize={setOnionize}
                          />
                        )}
                        {isSettings && <SettingsView nightModeTabId={lastBrowsedTabRef.current} />}
                      </ZoomedContent>
                    </ResizablePanel>
                    <ResizableHandle withHandle className="[-webkit-app-region:no-drag]" />
                    <ResizablePanel defaultSize={50} minSize={15}>
                      <ZoomedContent
                        key={secondaryId}
                        className="relative flex h-full flex-col overflow-hidden bg-background"
                      >
                        {secondaryTab?.isSettings && (
                          <SettingsView nightModeTabId={lastBrowsedTabRef.current} />
                        )}
                        {secondaryTab?.isHome && (
                          <HomeContent
                            urlDraft={secondaryHomeUrlDraft}
                            onUrlDraftChange={(value) => {
                              setSecondaryHomeUrlDraft(value);
                              setHomeSearchDraftStored(secondaryId, value);
                            }}
                            onSubmit={(raw) => {
                              const target = parseUrlBarInput(raw, isTorWindow);
                              clearHomeSearchDraft(secondaryId);
                              if (target && secondaryId) navigate(secondaryId, target);
                            }}
                            bookmarks={bookmarks}
                            onOpenBookmark={(url) => openBookmark(url, secondaryId)}
                            onOpenSlot={openSlot}
                            onRemoveSlot={remove}
                            privacyMode={homePrivacyMode}
                            searchEngineId={engine}
                            onionize={onionize}
                            onToggleOnionize={setOnionize}
                          />
                        )}
                        {/* Neither home nor settings — a real page, shown by the
                        native view the backend positions into this exact
                        half (see applySplitLayout in tab-manager.ts). */}
                      </ZoomedContent>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                ) : (
                  <ZoomedContent
                    key={activeId}
                    className="relative flex h-full w-full flex-1 flex-col overflow-hidden"
                  >
                    {isHome && !isHomeLoading && (
                      <HomeContent
                        urlDraft={homeUrlDraft}
                        onUrlDraftChange={(value) => {
                          setHomeUrlDraft(value);
                          setHomeSearchDraftStored(activeId, value);
                        }}
                        onSubmit={submitUrl}
                        bookmarks={bookmarks}
                        onOpenBookmark={(url) => openBookmark(url)}
                        onOpenSlot={openSlot}
                        onRemoveSlot={remove}
                        privacyMode={homePrivacyMode}
                        searchEngineId={engine}
                        onionize={onionize}
                        onToggleOnionize={setOnionize}
                      />
                    )}
                    {isSettings && <SettingsView nightModeTabId={lastBrowsedTabRef.current} />}
                  </ZoomedContent>
                )}
              </div>
              {zoraOpen && (
                <div className="flex h-full w-[404px] shrink-0 flex-col p-2">
                  <div className="flex h-full w-full flex-col rounded-2xl border border-[var(--chrome-border)] bg-background p-2 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
                    <ZoraSidebar />
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tor connecting screen — blocks everything (no tabs, no address
          bar interaction) until Tor actually reports 100% bootstrapped.
          Letting anything load before that would mean a request slipping
          out before the SOCKS routing is actually in place — see
          createTorWindow in main.ts for why the proxy is only applied at
          "ready", not any earlier. */}
      {isTorWindow && torStatus.state !== "ready" && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-[#160f26] text-white">
          <TorOnionLogo className="h-12 w-12 text-[#8a5fc4]" strokeWidth={1.5} />
          {torStatus.state === "error" ? (
            <>
              <p className="max-w-sm text-center text-[14px] leading-relaxed text-white/90">
                {torStatus.message}
              </p>
              <p className="max-w-sm text-center text-[12px] leading-relaxed text-white/50">
                Get the official Tor binary from torproject.org, then set its path in Settings →
                Privacy → Tor.
              </p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium">Connecting to the Tor network…</p>
              <div className="h-1 w-64 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#8a5fc4] transition-all duration-300"
                  style={{
                    width: `${torStatus.state === "starting" ? torStatus.bootstrapPercent : 0}%`,
                  }}
                />
              </div>
              <p className="text-[12px] text-white/50">
                {torStatus.state === "starting" ? torStatus.message : "Starting Tor…"}
              </p>
            </>
          )}
        </div>
      )}

      {/* The profile popup itself now renders in the native overlay window
          — see openProfilePopup above and src/routes/overlay.tsx — nothing
          left to render inline here. */}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Columns2, Copy, Download, Edit3, ExternalLink, EyeOff, FolderPlus, Globe, Link2, PictureInPicture2, Plus, RotateCw, Search, Settings, SquareArrowOutUpRight, Star, User, X } from "lucide-react";
import { TorOnionLogo } from "@/components/TorOnionLogo";
import { QueckSilverLogo } from "@/components/QueckSilverLogo";
import { TabStrip } from "@/components/TabStrip";
import { SearchEngineChooser } from "@/components/SearchEngineChooser";
import { HeaderFavoritesBar } from "@/components/HeaderFavoritesBar";
import { SettingsView } from "@/components/SettingsView";
import { FavIcon } from "@/components/FavIcon";
import { HomeContent } from "@/components/HomeContent";
import { PageScrollbar } from "@/components/PageScrollbar";
import { ZoomedContent } from "@/components/ZoomedContent";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { setPendingSettingsAnchor } from "@/lib/settings-anchor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBrowserApi, HOME_URL, SETTINGS_URL } from "@/hooks/use-browser-api";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useHeaderFavorites } from "@/hooks/use-header-favorites";
import { useDownloads } from "@/hooks/use-downloads";
import { useToolbarIconOrder, useZoomLevel, useHeaderFavoritesBarVisible, useSearchEngine, SEARCH_ENGINES, type ToolbarIconId } from "@/lib/settings-store";
import { useToolbarStyle } from "@/lib/toolbar-style";
import { ToolbarActionIcons, type ToolbarAction } from "@/components/ToolbarActionIcons";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import { useTorStatus } from "@/hooks/use-tor-status";
import { ProfilePopup } from "@/components/ProfilePopup";
import { useWindowControls } from "@/hooks/use-window-controls";
import { parseUrlBarInput } from "@/lib/url-bar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "QueckSilver Search" },
      { name: "description", content: "A calm, minimal desktop browser." },
      { property: "og:title", content: "QueckSilver Search" },
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

// Cycled through when a new tab group is created via the tab context menu
// — same idea as Chrome's fixed group color palette, just QueckSilver's own
// swatch instead of reusing Chrome's exact hues.
const TAB_GROUP_COLORS = ["#4a7c9e", "#c2694a", "#5a9e6f", "#9e7c4a", "#8a5a9e", "#4a9e9e"];

// A single right-click-menu row — icon + label, rounded and inset from the
// menu's own edges (the outer menu's own p-1.5 padding is what keeps the
// hover highlight from ever touching the edge, this button just needs to
// fill that padded area and be rounded itself).
function ContextMenuActionItem({ icon: Icon, label, onClick }: { icon: React.FC<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted">
      <Icon className="h-[15px] w-[15px] shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}

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
  const { bookmarks, setBookmarks } = useBookmarks();
  const { favorites: headerFavorites, add: addHeaderFavorite, reorder: reorderHeaderFavorites } = useHeaderFavorites();
  const { visible: headerFavoritesBarVisible } = useHeaderFavoritesBarVisible();
  const { items: downloadItems } = useDownloads();
  const activeDownloadCount = downloadItems.filter((d) => d.state === "progressing").length;
  // The toolbar's unified download state (see ToolbarActionIcons) can only
  // show one download at a time, so when several run at once we surface
  // the most recently started one — that's the one the person just kicked
  // off and is most likely watching.
  const activeDownload = downloadItems
    .filter((d) => d.state === "progressing")
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const { order: toolbarIconOrder, moveIcon: moveToolbarIcon } = useToolbarIconOrder();
  const { engine, setEngine } = useSearchEngine();
  const currentEngine = SEARCH_ENGINES.find((e) => e.id === engine) ?? SEARCH_ENGINES[0]!;
  const { style: toolbarStyle } = useToolbarStyle();
  const [draggedIcon, setDraggedIcon] = useState<ToolbarIconId | null>(null);
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
  const { profiles, active: activeIdentity, activeProfile, isGuest, createSimpleProfile, removeProfile, syncNow, openProfileInNewWindow, openGuestInNewWindow, openIncognitoInNewWindow, openTorInNewWindow } = useProfiles();
  const isTorWindow = activeIdentity.windowMode === "tor";
  // Drives the Start page's privacy explainer (see HomeContent) instead of
  // the usual 5 bookmark tiles - "guest" covers both plain guest mode and
  // incognito/tor (which are guest mode plus a windowMode), so this checks
  // windowMode first for the more specific label.
  const homePrivacyMode: "incognito" | "tor" | "guest" | null = activeIdentity.windowMode === "tor" ? "tor" : activeIdentity.windowMode === "incognito" ? "incognito" : activeIdentity.guestMode ? "guest" : null;
  const { status: torStatus, newIdentity: torNewIdentity } = useTorStatus();
  const { minimize, toggleMaximize, close: closeWindow, isMaximized, setFullScreen, getIsFullscreen, onShortcutF11, onShortcutEscape, onShortcutFocusUrlBar, onShortcutAddFavorite, onShortcutFindInPage, onShortcutTabSearch, onShortcutOpenPasswordSettings, onFullscreenChanged } = useWindowControls();

  const platform = typeof window !== "undefined" ? window.platformInfo?.platform : undefined;
  const hasNativeControls = platform === "darwin";

  // F11 "fullscreen" — mirrors the window's real fullscreen state, updated
  // only via the authoritative onFullscreenChanged event (see toggleChrome
  // below) so it can never get stuck out of sync with what Electron/Windows
  // actually did.
  const [chromeHidden, setChromeHidden] = useState(false);

  const [slot, setSlot] = useState<number | null>(null);
  const [form, setForm] = useState({ label: "", url: "" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [profilePopupOpen, setProfilePopupOpen] = useState(false);
  // Captured from the profile button's own getBoundingClientRect() at
  // click time - lets ProfilePopup anchor itself right off that button
  // (top-right, matching a real browser's account switcher) instead of
  // opening as a centered modal.
  const [profileAnchorRect, setProfileAnchorRect] = useState<{ top: number; left: number; right: number; bottom: number } | null>(null);
  const openProfilePopup = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setProfileAnchorRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom });
    setProfilePopupOpen(true);
  };
  const [urlDraft, setUrlDraft] = useState("");
  const [homeUrlDraft, setHomeUrlDraft] = useState("");
  const [secondaryHomeUrlDraft, setSecondaryHomeUrlDraft] = useState("");
  const [urlCopied, setUrlCopied] = useState(false);
  const [autoSavedPill, setAutoSavedPill] = useState<{ url: string; username: string } | null>(null);
  // "New group" popup — asks for a name + color instead of assigning one
  // silently, opened from the tab context menu (see TabStrip's
  // onCreateGroup). tabId is which tab triggered it, so confirming knows
  // what to assign the freshly-created group to.
  const [groupDialogTabId, setGroupDialogTabId] = useState<string | null>(null);
  const [groupDialogName, setGroupDialogName] = useState("");
  const [groupDialogColor, setGroupDialogColor] = useState(TAB_GROUP_COLORS[0]!);
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
  const [findBar, setFindBar] = useState<{ query: string; matches: number; activeMatchOrdinal: number } | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  // Ctrl+Shift+A — command-palette-style tab search.
  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const [tabSearchQuery, setTabSearchQuery] = useState("");
  const tabSearchInputRef = useRef<HTMLInputElement | null>(null);
  // Right-click on an image/link/selection inside a tab — see
  // tab-manager.ts's "context-menu" listener + main.ts's showContextMenu.
  // Includes a screenshot captured at the moment of the click: showing
  // this menu means hiding the tab's native view (see anyDialogOpen
  // below and the big comment on showContextMenu for why that's
  // unavoidable), and a frozen picture of the page reads as "paused"
  // instead of "gone" while it's hidden.
  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
    boundsX: number;
    boundsY: number;
    boundsWidth: number;
    boundsHeight: number;
    srcURL: string | null;
    linkURL: string | null;
    selectionText: string | null;
    screenshot: string | null;
    isChromeUI: boolean;
  } | null>(null);
  const contextMenuPopupRef = useRef<HTMLDivElement | null>(null);
  // Always-ready standby copy of the active tab's last background capture
  // — invisible during normal browsing (the live native view sits on top
  // of it the whole time, same as everything else in the chrome UI), but
  // means opening a context menu no longer needs to wait on the actual
  // image arriving over IPC at click time at all: it's already sitting
  // right here, already decoded and painted, the instant it's needed.
  const [standbyScreenshot, setStandbyScreenshot] = useState<{ tabId: string; url: string } | null>(null);
  const [contentBounds, setContentBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useEffect(() => {
    return window.browserAPI?.tabs.onBackgroundScreenshotUpdate((payload) => {
      setStandbyScreenshot({ tabId: payload.tabId, url: payload.screenshot });
    });
  }, []);

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

  const anyDialogOpen = dialogOpen || profilePopupOpen || groupDialogTabId !== null || tabSearchOpen || contextMenu !== null;
  // Dialogs have their own full-screen dark backdrop — but that backdrop is
  // DOM, and native content always paints above ALL DOM regardless, so it
  // can't actually show the page dimmed-but-visible underneath either.
  // Hiding here isn't "lossless", it's the same trade-off as everywhere
  // else, just applied to the whole window instead of a corner. Settings
  // itself is no longer a dialog at all now — it's regular tab content
  // (see isSettings above), so it never needs this in the first place.
  const nativeShouldHide = anyDialogOpen;

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
  const cachedFrequentSitesRef = useRef<{ domain: string; visitCount: number; lastVisit: number }[]>([]);
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
    const favoriteMatch = favoriteDomains.find((d) => d.length > typedValue.length && d.toLowerCase().startsWith(typedValue.toLowerCase()));
    if (favoriteMatch) return favoriteMatch;
    const cachedMatch = cachedFrequentSitesRef.current
      .filter((s) => s.domain.length > typedValue.length && s.domain.toLowerCase().startsWith(typedValue.toLowerCase()))
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
      if (!top || top.domain.length <= typedValue.length || !top.domain.toLowerCase().startsWith(typedValue.toLowerCase())) return;
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
  // Same autocomplete, for the bookmark-slot dialog's URL field.
  const [bookmarkUrlFocused, setBookmarkUrlFocused] = useState(false);
  const [bookmarkUrlSuggestions, setBookmarkUrlSuggestions] = useState<{ domain: string; visitCount: number; lastVisit: number }[]>([]);
  useEffect(() => {
    if (!bookmarkUrlFocused || !form.url.trim()) {
      setBookmarkUrlSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      window.browserAPI?.frequentSites.list(form.url).then((results) => {
        if (!cancelled) setBookmarkUrlSuggestions(results);
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bookmarkUrlFocused, form.url]);
  const editingUrlRef = useRef(false);
  editingUrlRef.current = editingUrl;
  useEffect(() => {
    // Simple on purpose: only ever actively BLANK the field for the two
    // clear, stable states (home/settings). For every other update,
    // either it's a real, usable URL (show it) or it's some transient
    // in-between value the backend reports mid-navigation (about:blank,
    // the sentinel URLs, empty) — and for those, just don't touch
    // urlDraft at all, leave whatever's already showing exactly as is.
    // Trying to actively chase down and blank every transient value was
    // the actual bug — this only ever adds text, never removes it, except
    // for the two real "should be blank" cases.
    if (editingUrlRef.current) return;
    if (isHome || isSettings) {
      setUrlDraft("");
      return;
    }
    const url = activeTab?.url ?? "";
    if (!url || url === HOME_URL || url === SETTINGS_URL || url === "about:blank") return;
    setUrlDraft(url);
  }, [activeTab?.url, isHome]);

  const secondaryIsHome = secondaryTab?.isHome ?? false;
  const secondaryIsSettings = secondaryTab?.isSettings ?? false;

  useEffect(() => {
    if (nativeShouldHide) {
      setVisible(false);
      return;
    }
    if (secondaryId) {
      // In split view either half might be the only one that actually
      // needs a native page attached — the backend's own applySplitLayout
      // decides per side, this just needs to know whether ANY native
      // content is needed at all right now.
      const leftNeedsNative = !(isHome || isSettings);
      const rightNeedsNative = !(secondaryIsHome || secondaryIsSettings);
      setVisible(leftNeedsNative || rightNeedsNative);
    } else {
      setVisible(!isHome && !isSettings);
    }
  }, [isHome, isSettings, secondaryId, secondaryIsHome, secondaryIsSettings, nativeShouldHide, setVisible]);

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
      const inset = chromeHidden ? { top: 0, right: 0, bottom: 0, left: 0 } : CONTENT_INSET;
      const nextBounds = {
        x: Math.round(rect.x + inset.left),
        y: Math.round(rect.y + inset.top),
        width: Math.round(Math.max(0, rect.width - inset.left - inset.right)),
        height: Math.round(Math.max(0, rect.height - inset.top - inset.bottom)),
      };
      setBounds(nextBounds);
      setContentBounds(nextBounds);
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
      setFindBar((prev) => (prev ? { ...prev, matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal } : prev));
    });
  }, [activeId]);

  // Right-click context menu — only meaningful for the active tab (a
  // background tab can't be the one currently being right-clicked).
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.browserAPI?.tabs : undefined;
    if (!api) return;
    return api.onContextMenuRequest((payload) => {
      if (payload.tabId !== activeId) return;
      setContextMenu(payload);
    });
  }, [activeId]);

  // Centralized so every menu-item click and the backdrop click all go
  // through the same restore-before-clear ordering — the native view's
  // restore is itself an async IPC round trip (setVisible has to ask the
  // main process to actually reattach it), and clearing contextMenu
  // (removing the screenshot backdrop + the menu itself) BEFORE that
  // finishes would leave a gap where neither the frozen picture nor the
  // real live page is on screen, just the bare chrome UI background —
  // the same kind of visible cut this whole screenshot approach was
  // trying to avoid on the way in. Awaiting it first means the backdrop
  // stays put right up until the real page is confirmed back, so there's
  // never a frame with nothing under the cursor.
  const closeContextMenu = () => {
    if (!contextMenu || contextMenu.isChromeUI) {
      setContextMenu(null);
      return;
    }
    window.browserAPI?.tabs.setVisible(true).finally(() => setContextMenu(null));
  };
  // Closes the menu on any interaction outside its own popup — WITHOUT
  // blocking/consuming the event, unlike the content-area backdrop above
  // (which intentionally does swallow its click, since clicking the frozen
  // page has nothing underneath it to actually hit). This is specifically
  // for the header/toolbar/tab strip — those areas have real buttons that
  // need to receive the click themselves too, not just close the menu and
  // require a second click to actually press them. mousedown, not click —
  // fires earlier, so the menu is already closing by the time the target
  // element's own click handler runs.
  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // right-clicks are handled separately by onContextMenu — don't race with retriggerContextMenuAt
      if (contextMenuPopupRef.current?.contains(e.target as Node)) return;
      closeContextMenu();
    };
    // Scrolling (mouse wheel or trackpad) anywhere while the menu is open
    // — the page underneath is a frozen picture at this point, so there's
    // nothing for a scroll to actually do there anyway, and leaving the
    // menu open while the person's clearly moved on to something else
    // just gets in the way. Doesn't need the same "let it reach its real
    // target" treatment mousedown gets above — scrolling isn't a targeted
    // interaction the way clicking a specific button is, there's nothing
    // it would otherwise need to still receive.
    const onWheel = (e: WheelEvent) => {
      if (contextMenuPopupRef.current?.contains(e.target as Node)) return; // scrolling inside the menu itself (unlikely to ever be tall enough to need it, but just in case) shouldn't close it
      closeContextMenu();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("wheel", onWheel);
    };
  }, [contextMenu]);

  // Right-clicking the backdrop of an already-open menu — the backdrop is
  // a frozen picture, not the real page, so there's no way to know what's
  // actually at that point (an image? a link? nothing?) without asking the
  // real page. Fires a synthetic right-click straight at the tab's
  // webContents WITHOUT restoring its visibility first — sendInputEvent
  // is delivered to the renderer process directly and hit-tested against
  // its own DOM/layout, which doesn't require the view to be attached to
  // the window's visible compositor tree at all, so there's no need to
  // show the real page (and hide it again right after) just to ask it a
  // question. Chromium's own context-menu detection still fires exactly
  // as if a person had actually clicked there, landing right back in the
  // usual onContextMenuRequest flow with a fresh, honest menu for
  // whatever's really there — and since the page was never shown again in
  // between, the SAME backdrop just keeps sitting there the whole time
  // (nothing to visually cut at all, unless the new menu's own content —
  // a genuinely different image/link/text — means it needs updating,
  // which is a prop change on an already-mounted element, not a hide/show
  // cycle). contextMenu is deliberately NOT cleared here — the new
  // request coming back in updates it in place.
  const retriggerContextMenuAt = (e: React.MouseEvent) => {
    if (!contextMenu || contextMenu.isChromeUI) {
      setContextMenu(null);
      return;
    }
    const tabId = contextMenu.tabId;
    const contentX = e.clientX - contextMenu.boundsX;
    const contentY = e.clientY - contextMenu.boundsY;
    window.browserAPI?.tabs.simulateRightClickAt(tabId, contentX, contentY);
  };

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
  // Chat pill (next to the profile button) — briefly shows "Coming soon"
  // on click, then reverts on its own, same timer pattern as autoSavedPill.
  const [chatComingSoon, setChatComingSoon] = useState(false);
  const chatComingSoonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      setTabSearchQuery("");
      setTabSearchOpen(true);
      setTimeout(() => tabSearchInputRef.current?.focus(), 0);
    });
    const unsubOpenPasswordSettings = onShortcutOpenPasswordSettings(() => goToSettings("passwords"));
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
    setSlot(index);
    setForm({ label: existing?.label ?? "", url: existing?.url ?? "" });
    setDialogOpen(true);
  };

  const save = () => {
    const label = form.label.trim();
    if (slot === null || !label) return;
    const url = normalizeBookmarkUrl(form.url);
    setBookmarks((prev) => prev.map((b, i) => (i === slot ? { label, url } : b)));
    notifySuccess("Bookmark saved");
    setDialogOpen(false);
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
      await navigator.clipboard.writeText(activeTab?.url ?? "");
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1400);
    } catch {
      notifyError("Could not copy URL");
    }
  };

  const submitUrl = (raw: string) => {
    const target = parseUrlBarInput(raw);
    if (!target) {
      notifyError("Enter a valid URL");
      return;
    }
    // Set right away instead of waiting for activeTab.url to catch up via
    // the backend round trip — without this there's a real gap where the
    // tab is no longer "home" but hasn't reported the new URL yet either,
    // during which the address bar had nothing correct to show at all.
    if (target !== HOME_URL) setUrlDraft(target);
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

  const openBookmark = (url: string, targetId: string | null = activeId) => {
    if (targetId === activeId && url !== HOME_URL) setUrlDraft(url);
    if (targetId) navigate(targetId, url);
    else newTab(url);
  };

  const openQuecksilverWebsite = () => {
    if (activeId) navigate(activeId, "https://quecksilver.ch");
    else newTab("https://quecksilver.ch");
  };

  const goToSettings = (section?: string) => {
    if (section) setPendingSettingsAnchor(section);
    if (activeId) navigate(activeId, SETTINGS_URL);
    else newTab(SETTINGS_URL);
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
    <div className={`flex h-screen w-screen flex-col overflow-hidden bg-background font-sans ${chromeHidden ? "" : "rounded-[10px]"}`}>
      {!chromeHidden && (
        <TabStrip
          tabs={tabs}
          groups={groups}
          activeId={activeId}
          loadingTabIds={loadingHomeTabs}
          onSelect={(id) => switchTab(id)}
          onClose={(id) => closeTab(id)}
          onToggleMute={(id) => window.browserAPI?.tabs.toggleMute(id)}
          onReorder={(newOrder) => reorderTabs(newOrder)}
          onNewTab={() => newTab()}
          onLogoClick={openQuecksilverWebsite}
          onToggleGroupCollapse={(groupId) => {
            const group = groups.find((g) => g.id === groupId);
            if (group) setGroupCollapsed(groupId, !group.collapsed);
          }}
          onCreateGroup={(tabId) => {
            setGroupDialogTabId(tabId);
            setGroupDialogName("");
            setGroupDialogColor(TAB_GROUP_COLORS[groups.length % TAB_GROUP_COLORS.length]!);
          }}
          onAddToGroup={(tabId, groupId) => setTabGroup(tabId, groupId)}
          onRemoveFromGroup={(tabId) => setTabGroup(tabId, null)}
          onDeleteGroup={(groupId) => {
            for (const t of tabs) if (t.groupId === groupId) closeTab(t.id);
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
      <div className="relative flex shrink-0 items-center gap-2.5 bg-background px-3 py-2">
        <button
          onClick={() => activeId && goBack(activeId)}
          disabled={!activeTab?.canGoBack}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-30"
        >
          <ArrowLeft className="h-[17px] w-[17px]" />
        </button>
        <button
          onClick={() => activeId && goForward(activeId)}
          disabled={!activeTab?.canGoForward}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-30"
        >
          <ArrowRight className="h-[17px] w-[17px]" />
        </button>
        <button
          onClick={() => activeId && reload(activeId)}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-foreground transition-colors hover:bg-foreground/5"
        >
          <RotateCw className="h-4 w-4" />
        </button>

        <div className="relative max-w-[900px] flex-1">
          <div
            className={`flex items-center gap-2.5 rounded-full py-[6px] pl-4 pr-2.5 transition-shadow ${editingUrl ? "ring-2 ring-[var(--brand)]" : ""}`}
            style={{ background: "var(--chrome-field)" }}
          >
          {activeTab?.isHome ? (
            // On the Start page there's no URL to copy, so this slot
            // becomes a search-engine picker instead — the icon of
            // whichever engine currently handles the Start page's search
            // bar, with a dropdown to switch it right there instead of
            // needing a trip to Settings.
            <SearchEngineChooser engine={engine} onChange={setEngine} variant="inline" />
          ) : (
            <button onClick={copyUrl} aria-label="Copy URL" className={`shrink-0 ${urlCopied ? "text-green-600" : "text-muted-foreground"}`}>
              {urlCopied ? (
                <Check className="h-[14px] w-[14px]" strokeWidth={2.5} />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              )}
            </button>
          )}
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
              // Reverts any unsubmitted typed text back to the real
              // current URL — previously handled implicitly by the sync
              // effect re-running off editingUrl changing, which is
              // exactly the mechanism removed above to stop the flash;
              // doing it explicitly here keeps that original behavior
              // without bringing the flash back.
              const url = activeTab?.url ?? "";
              setUrlDraft(isHome || url === HOME_URL || url === SETTINGS_URL || url === "about:blank" ? "" : url);
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
              const eligible = editingUrl && raw.trim().length >= 3 && (dismissed === null || raw.length >= dismissed + 2);
              const match = eligible ? computeBestMatch(raw) : null;
              if (match && match.length > raw.length) {
                if (dismissed !== null) dismissedAtLengthRef.current = null;
                pendingCompletionSelectionRef.current = { start: raw.length, end: match.length };
                programmaticUrlChangeRef.current = true; // the effect below would otherwise redundantly redo this exact lookup on its next run
                setUrlDraft(match);
                return;
              }
              pendingCompletionSelectionRef.current = null;
              programmaticUrlChangeRef.current = false;
              setUrlDraft(raw);
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
                const remainingLength = el.selectionStart !== el.selectionEnd ? (el.selectionStart ?? 0) : Math.max(0, el.value.length - 1);
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
                const finalValue = match && match.length > typedSoFar.length ? match : typedSoFar;
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
                pendingCompletionSelectionRef.current = match && match.length > typedSoFar.length ? { start: typedSoFar.length, end: finalValue.length } : null;
                programmaticUrlChangeRef.current = true;
                setUrlDraft(finalValue);
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
          {isTorWindow && (
            <button
              onClick={requestNewTorIdentity}
              aria-label="New Tor identity"
              title={identityRequested ? "New identity requested" : torStatus.state === "ready" ? "New Identity, clears this window's session and gets fresh circuits" : "Connecting to Tor…"}
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${identityRequested ? "text-[#8a5fc4]" : "text-[#8a5fc4] hover:bg-[#8a5fc4]/10"}`}
            >
              {identityRequested ? <Check className="h-[16px] w-[16px]" strokeWidth={2} /> : <TorOnionLogo className="h-[21px] w-[21px]" strokeWidth={1.5} />}
            </button>
          )}
          <button
            onClick={starCurrentPage}
            aria-label="Add to favorites"
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-foreground/10 ${starFlash ? "text-foreground" : "text-muted-foreground"}`}
          >
            <Star className="h-[17px] w-[17px]" strokeWidth={1.5} fill={starFlash ? "currentColor" : "none"} />
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
                {findBar.matches > 0 ? `${findBar.activeMatchOrdinal}/${findBar.matches}` : findBar.query ? "0/0" : ""}
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
                    const next = prev.activeMatchOrdinal <= 1 ? prev.matches : prev.activeMatchOrdinal - 1;
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
                    const next = prev.activeMatchOrdinal >= prev.matches ? 1 : prev.activeMatchOrdinal + 1;
                    return { ...prev, activeMatchOrdinal: next };
                  });
                  window.browserAPI?.tabs.findInPage(findBar.query, true, true);
                }}
                aria-label="Next match"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-foreground/10"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button onClick={closeFindBar} aria-label="Close find bar" className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-foreground/10">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : sessionRestore ? (
            <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-[13px] font-semibold text-foreground">
              <span>
                Restore {sessionRestore.tabCount} tab{sessionRestore.tabCount === 1 ? "" : "s"} from last session?
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
              <button onClick={() => setUpdateReady(false)} className="rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:bg-foreground/10">
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
                activeDownload={activeDownload}
                actions={toolbarIconOrder.map((id) => {
                  const defs: Record<ToolbarIconId, ToolbarAction> = {
                    edit: { id: "edit", icon: Edit3, label: "Edit", onClick: () => goToSettings("favorites") },
                    settings: { id: "settings", icon: Settings, label: "Settings", onClick: () => goToSettings() },
                    download: {
                      id: "download",
                      icon: Download,
                      label: "Downloads",
                      onClick: () => goToSettings("downloads"),
                      busy: activeDownloadCount > 0,
                      justDone: justCompletedDownload,
                    },
                    split: { id: "split", icon: Columns2, label: "Split", onClick: toggleSplit, active: Boolean(secondaryId) },
                    pip: { id: "pip", icon: PictureInPicture2, label: "Picture-in-Picture", onClick: () => void togglePiP() },
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
                  aria-label={isTorWindow ? "Tor" : activeIdentity.windowMode === "incognito" ? "Incognito" : "Guest"}
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
                  aria-label={activeProfile.kind === "quecksilver" && activeProfile.email ? nameFromEmail(activeProfile.email) : activeProfile.name}
                  className="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-full border-4 border-white text-[11px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                  style={{ background: activeProfile.kind === "quecksilver" ? "var(--brand)" : "hsl(240 4% 46%)" }}
                >
                  {(activeProfile.kind === "quecksilver" ? activeProfile.email : activeProfile.name)?.charAt(0).toUpperCase() ?? "?"}
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
                  h-8, matching shadow). Product isn't live yet, so the click
                  is just a brief "Coming soon" flip instead of navigating
                  anywhere — chatComingSoon reverts on its own timer, same
                  pattern as autoSavedPill above. */}
              <button
                onClick={() => {
                  setChatComingSoon(true);
                  if (chatComingSoonTimer.current) clearTimeout(chatComingSoonTimer.current);
                  chatComingSoonTimer.current = setTimeout(() => setChatComingSoon(false), 1400);
                }}
                className="ml-2 flex h-8 items-center gap-1.5 rounded-full bg-card pl-2 pr-3.5 text-[13px] font-semibold text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
              >
                {chatComingSoon ? (
                  <span className="px-0.5">Coming soon</span>
                ) : (
                  <>
                    <QueckSilverLogo className="h-4 w-4" style={{ color: "var(--brand)" }} />
                    Chat
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
      )}

      {/* Header favorites bar — separate from the 5 home-page slots.
          Toggleable from Settings (next to "Add favorite") independent of
          the favorites list itself — hiding the bar doesn't touch any
          saved favorite. */}
      {!chromeHidden && !isGuest && headerFavoritesBarVisible && headerFavorites.length > 0 && (
        <div className="flex shrink-0 items-center bg-background px-3 pb-2 pt-0">
          <HeaderFavoritesBar
            favorites={headerFavorites}
            onOpen={openBookmark}
            onReorder={reorderHeaderFavorites}
            renderIcon={(f) => <FavIcon url={f.url} label={f.label} size="h-5 w-5" />}
          />
        </div>
      )}

      {/* Content — flush with the real window edges (no gap) so Windows'
          automatic DWM corner-rounding on this frameless window actually
          applies to it, same as Edge/Chrome do. A gap here would put native
          page content away from the true window boundary and the OS
          rounding would have nothing to clip. In fullscreen this is the
          ONLY thing visible — chrome above is hidden entirely. */}
      <div ref={pageScrollRef} className="relative flex-1 overflow-y-auto bg-background">
        <PageScrollbar scrollRef={pageScrollRef} />
        <div className="flex h-full flex-col bg-background">
          <div ref={contentRef} className="relative flex h-full w-full flex-1 overflow-hidden">
            {secondaryId ? (
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize={50} minSize={15} onResize={(size) => setSplitRatio(size.asPercentage / 100)}>
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
                  <ZoomedContent key={activeId} className="relative flex h-full flex-col overflow-hidden">
                    {isHome && !isHomeLoading && (
                      <HomeContent
                        urlDraft={homeUrlDraft}
                        onUrlDraftChange={setHomeUrlDraft}
                        onSubmit={submitUrl}
                        bookmarks={bookmarks}
                        onOpenBookmark={(url) => openBookmark(url)}
                        onOpenSlot={openSlot}
                        onRemoveSlot={remove}
                        privacyMode={homePrivacyMode}
                      />
                    )}
                    {isSettings && <SettingsView nightModeTabId={lastBrowsedTabRef.current} />}
                  </ZoomedContent>
                </ResizablePanel>
                <ResizableHandle withHandle className="[-webkit-app-region:no-drag]" />
                <ResizablePanel defaultSize={50} minSize={15}>
                  <ZoomedContent key={secondaryId} className="relative flex h-full flex-col overflow-hidden bg-background">
                    {secondaryTab?.isSettings && <SettingsView nightModeTabId={lastBrowsedTabRef.current} />}
                    {secondaryTab?.isHome && (
                      <HomeContent
                        urlDraft={secondaryHomeUrlDraft}
                        onUrlDraftChange={setSecondaryHomeUrlDraft}
                        onSubmit={(raw) => {
                          const target = parseUrlBarInput(raw);
                          if (target && secondaryId) navigate(secondaryId, target);
                        }}
                        bookmarks={bookmarks}
                        onOpenBookmark={(url) => openBookmark(url, secondaryId)}
                        onOpenSlot={openSlot}
                        onRemoveSlot={remove}
                        privacyMode={homePrivacyMode}
                      />
                    )}
                    {/* Neither home nor settings — a real page, shown by the
                        native view the backend positions into this exact
                        half (see applySplitLayout in tab-manager.ts). */}
                  </ZoomedContent>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <ZoomedContent key={activeId} className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
                {isHome && !isHomeLoading && (
                  <HomeContent
                    urlDraft={homeUrlDraft}
                    onUrlDraftChange={setHomeUrlDraft}
                    onSubmit={submitUrl}
                    bookmarks={bookmarks}
                    onOpenBookmark={(url) => openBookmark(url)}
                    onOpenSlot={openSlot}
                    onRemoveSlot={remove}
                    privacyMode={homePrivacyMode}
                  />
                )}
                {isSettings && <SettingsView nightModeTabId={lastBrowsedTabRef.current} />}
              </ZoomedContent>
            )}
          </div>
        </div>
      </div>

      {/* Bookmark dialog (home-page slots) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bookmark</DialogTitle>
            <DialogDescription>Name and address of the bookmark.</DialogDescription>
          </DialogHeader>
          {/* A real <form onSubmit> (not just a Save button's onClick) is
              what makes Enter work in either field — the browser submits
              the nearest form on Enter in a text input natively, no manual
              keydown wiring needed. type="submit" on the Save button ties
              it to the same submit event instead of a second onClick path,
              so both ways of saving stay in sync automatically. */}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="bm-label">Name</Label>
              <Input id="bm-label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="" />
            </div>
            <div className="relative space-y-1.5">
              <Label htmlFor="bm-url">URL</Label>
              <Input
                id="bm-url"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                onFocus={() => setBookmarkUrlFocused(true)}
                onBlur={() => setTimeout(() => setBookmarkUrlFocused(false), 150)}
                placeholder=""
              />
              {bookmarkUrlFocused && bookmarkUrlSuggestions.length > 0 && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
                  {bookmarkUrlSuggestions.map((s) => (
                    <button
                      key={s.domain}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setForm((f) => ({ ...f, url: `https://${s.domain}` }));
                        setBookmarkUrlFocused(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-muted"
                    >
                      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-foreground">{s.domain}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New tab group — asks for a name + color, opened from the tab
          context menu (see TabStrip.tsx's onCreateGroup). */}
      <Dialog open={groupDialogTabId !== null} onOpenChange={(open) => !open && setGroupDialogTabId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-4 w-4" />
              New tab group
            </DialogTitle>
            <DialogDescription>Name and color for the group.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                value={groupDialogName}
                onChange={(e) => setGroupDialogName(e.target.value)}
                placeholder="New group"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex gap-2">
                {TAB_GROUP_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setGroupDialogColor(color)}
                    aria-label={`Color ${color}`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full ring-offset-2 transition-all"
                    style={{ background: color, boxShadow: groupDialogColor === color ? `0 0 0 2px ${color}` : undefined }}
                  >
                    {groupDialogColor === color && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGroupDialogTabId(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!groupDialogTabId) return;
                const groupId = await createGroup(groupDialogName.trim() || "New group", groupDialogColor);
                if (groupId) setTabGroup(groupDialogTabId, groupId);
                setGroupDialogTabId(null);
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tab search — Ctrl+Shift+A, a command-palette-style filter over
          every open tab's title/URL. Reuses the Dialog primitive rather
          than the toolbar-pill pattern (find bar, session restore) since
          this needs a taller, scrollable list rather than a single-line
          control. */}
      <Dialog open={tabSearchOpen} onOpenChange={setTabSearchOpen}>
        <DialogContent className="gap-0 p-0">
          <div className="border-b border-border p-3">
            <Input
              ref={tabSearchInputRef}
              value={tabSearchQuery}
              onChange={(e) => setTabSearchQuery(e.target.value)}
              placeholder="Search open tabs"
              onKeyDown={(e) => {
                if (e.key === "Escape") setTabSearchOpen(false);
              }}
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {tabs
              .filter((t) => {
                const q = tabSearchQuery.trim().toLowerCase();
                if (!q) return true;
                return t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q);
              })
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    switchTab(t.id);
                    setTabSearchOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
                >
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">{t.isHome ? "New Tab" : t.isSettings ? "Settings" : t.title || t.url}</div>
                    {!t.isHome && !t.isSettings && <div className="truncate text-[11px] text-muted-foreground">{t.url}</div>}
                  </div>
                </button>
              ))}
            {tabs.filter((t) => {
              const q = tabSearchQuery.trim().toLowerCase();
              if (!q) return true;
              return t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q);
            }).length === 0 && <p className="px-2.5 py-4 text-center text-[13px] text-muted-foreground">No matching tabs</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Right-click menu — see the contextMenu state's own comment for
          why this includes a frozen screenshot of the page underneath: a
          DOM popup can only ever render on top of the tab's native view by
          hiding that view first (see anyDialogOpen above), and a plain
          blank rectangle where the page just was reads as "it broke", not
          "there's a menu open". The screenshot is sized/positioned to
          exactly match where the live page sits, so swapping one for the
          other is not noticeable beyond nothing moving under the cursor
          anymore. */}
      {/* Always mounted (not just while a menu is open) whenever there's a
          real page active — invisible in normal use since the live
          native view sits on top of it, but continuously rendered by the
          chrome UI's own webContents regardless (each webContents renders
          independently of whatever else is layered on top of it), so by
          the time a context menu needs to reveal it, it's already fully
          decoded and painted — nothing left to wait on there at all. */}
      {!isHome && !isSettings && standbyScreenshot?.tabId === activeId && contentBounds && (
        <div
          className="fixed z-[89] bg-cover bg-no-repeat"
          style={{ left: contentBounds.x, top: contentBounds.y, width: contentBounds.width, height: contentBounds.height, backgroundImage: `url(${standbyScreenshot.url})` }}
        />
      )}
      {contextMenu && (
        <>
          {/* Fallback only — the standby backdrop above already covers
              this in the common case. Only actually renders anything
              when there's a real page (!isChromeUI) AND nothing's been
              cached for it yet (e.g. a right-click within the very first
              second of a brand-new tab, before the background timer's
              first tick has run). */}
          {!contextMenu.isChromeUI && standbyScreenshot?.tabId !== contextMenu.tabId && (
            <div
              className="fixed z-[89] bg-cover bg-no-repeat"
              style={{
                left: contextMenu.boundsX,
                top: contextMenu.boundsY,
                width: contextMenu.boundsWidth,
                height: contextMenu.boundsHeight,
                backgroundImage: contextMenu.screenshot ? `url(${contextMenu.screenshot})` : undefined,
                backgroundColor: contextMenu.screenshot ? undefined : "var(--background)",
              }}
            />
          )}
          <div
            // Restricted to the content area's own bounds — same
            // boundsX/Y/Width/Height as the screenshot backdrop right
            // above — rather than the full viewport. Covering the whole
            // window meant a click on the TOOLBAR/tab strip/address bar
            // while this menu was open got swallowed by this div first
            // (just closing the menu), so using anything up there took
            // two separate clicks: one to close, a second to actually hit
            // the button. Chrome-UI-originated menus (Start page,
            // Settings — see contextMenu.isChromeUI) don't have this
            // problem in the first place, since there's no separate
            // native page underneath fighting for the same clicks, so
            // those keep the full-viewport catcher.
            className="fixed z-[90]"
            style={
              contextMenu.isChromeUI
                ? { top: 0, left: 0, right: 0, bottom: 0 }
                : { left: contextMenu.boundsX, top: contextMenu.boundsY, width: contextMenu.boundsWidth, height: contextMenu.boundsHeight }
            }
            onClick={() => closeContextMenu()}
            onContextMenu={(e) => {
              e.preventDefault();
              retriggerContextMenuAt(e);
            }}
          />
          <div
            ref={contextMenuPopupRef}
            className="fixed z-[91] w-64 overflow-hidden rounded-2xl border border-border bg-white p-1.5 shadow-2xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.srcURL && (
              <div className="flex flex-col">
                <ContextMenuActionItem
                  icon={Download}
                  label="Save image"
                  onClick={() => {
                    window.browserAPI?.images.saveDirect(contextMenu.srcURL!);
                    closeContextMenu();
                  }}
                />
                <ContextMenuActionItem
                  icon={Download}
                  label="Save image as…"
                  onClick={() => {
                    window.browserAPI?.images.save(contextMenu.srcURL!);
                    closeContextMenu();
                  }}
                />
                <ContextMenuActionItem
                  icon={Copy}
                  label="Copy image"
                  onClick={() => {
                    window.browserAPI?.images.copy(contextMenu.srcURL!);
                    closeContextMenu();
                  }}
                />
                <ContextMenuActionItem
                  icon={Link2}
                  label="Copy image address"
                  onClick={() => {
                    window.browserAPI?.images.copyLink(contextMenu.srcURL!);
                    closeContextMenu();
                  }}
                />
                <ContextMenuActionItem
                  icon={ExternalLink}
                  label="Open image in new tab"
                  onClick={() => {
                    window.browserAPI?.tabs.new(contextMenu.srcURL!);
                    closeContextMenu();
                  }}
                />
              </div>
            )}

            {contextMenu.srcURL && contextMenu.linkURL && <div className="mx-1 my-1 h-px bg-border" />}

            {contextMenu.linkURL && (
              <div className="flex flex-col">
                <ContextMenuActionItem
                  icon={ExternalLink}
                  label="Open link in new tab"
                  onClick={() => {
                    window.browserAPI?.links.openInNewTab(contextMenu.linkURL!);
                    closeContextMenu();
                  }}
                />
                <ContextMenuActionItem
                  icon={Copy}
                  label="Copy link"
                  onClick={() => {
                    window.browserAPI?.links.copy(contextMenu.linkURL!);
                    closeContextMenu();
                  }}
                />
                <ContextMenuActionItem
                  icon={SquareArrowOutUpRight}
                  label="Open link in new window"
                  onClick={() => {
                    window.browserAPI?.links.openInNewWindow(contextMenu.linkURL!);
                    closeContextMenu();
                  }}
                />
                <ContextMenuActionItem
                  icon={Download}
                  label="Save link as…"
                  onClick={() => {
                    window.browserAPI?.links.saveAs(contextMenu.linkURL!);
                    closeContextMenu();
                  }}
                />
                <ContextMenuActionItem
                  icon={Link2}
                  label="Open link"
                  onClick={() => {
                    window.browserAPI?.links.openHere(contextMenu.tabId, contextMenu.linkURL!);
                    closeContextMenu();
                  }}
                />
              </div>
            )}

            {contextMenu.selectionText && !contextMenu.srcURL && !contextMenu.linkURL && (
              <div className="flex flex-col">
                <ContextMenuActionItem
                  icon={Copy}
                  label="Copy"
                  onClick={() => {
                    window.browserAPI?.tabs.copySelectionFor(contextMenu.tabId);
                    closeContextMenu();
                  }}
                />
                <ContextMenuActionItem
                  icon={Search}
                  label={`Search the web for "${contextMenu.selectionText.length > 24 ? contextMenu.selectionText.slice(0, 24) + "…" : contextMenu.selectionText}"`}
                  onClick={() => {
                    window.browserAPI?.tabs.new(currentEngine.buildUrl(contextMenu.selectionText!));
                    closeContextMenu();
                  }}
                />
              </div>
            )}
          </div>
        </>
      )}

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
              <p className="max-w-sm text-center text-[14px] leading-relaxed text-white/90">{torStatus.message}</p>
              <p className="max-w-sm text-center text-[12px] leading-relaxed text-white/50">
                Get the official Tor binary from torproject.org, then set its path in Settings → Privacy → Tor.
              </p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium">Connecting to the Tor network…</p>
              <div className="h-1 w-64 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#8a5fc4] transition-all duration-300"
                  style={{ width: `${torStatus.state === "starting" ? torStatus.bootstrapPercent : 0}%` }}
                />
              </div>
              <p className="text-[12px] text-white/50">{torStatus.state === "starting" ? torStatus.message : "Starting Tor…"}</p>
            </>
          )}
        </div>
      )}

      <ProfilePopup
        open={profilePopupOpen}
        onOpenChange={setProfilePopupOpen}
        anchorRect={profileAnchorRect}
        profiles={profiles}
        active={activeIdentity}
        onOpenProfileInNewWindow={(id) => openProfileInNewWindow(id)}
        onOpenGuestInNewWindow={() => openGuestInNewWindow()}
        onOpenIncognitoInNewWindow={() => openIncognitoInNewWindow()}
        onOpenTorInNewWindow={() => openTorInNewWindow()}
        onRemove={(id) => {
          removeProfile(id);
          notify("Profile removed");
        }}
        onCreateSimple={(name) => createSimpleProfile(name)}
        onLoginQuecksilver={() => login("new-profile")}
        onSyncNow={() => syncNow()}
        loginPending={authPending}
      />
    </div>
  );
}

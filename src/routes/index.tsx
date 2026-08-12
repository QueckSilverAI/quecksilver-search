import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Columns2, Download, Edit3, RotateCw, Search, Settings, Star, User, X } from "lucide-react";
import { TabStrip } from "@/components/TabStrip";
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
import { useToolbarIconOrder, useZoomLevel, useHeaderFavoritesBarVisible, type ToolbarIconId } from "@/lib/settings-store";
import { useToolbarStyle } from "@/lib/toolbar-style";
import { ToolbarActionIcons, type ToolbarAction } from "@/components/ToolbarActionIcons";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
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

function Index() {
  const {
    tabs,
    activeId,
    activeTab,
    secondaryId,
    secondaryTab,
    isElectron,
    newTab,
    closeTab,
    switchTab,
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
  } = useBrowserApi();
  const { bookmarks, setBookmarks } = useBookmarks();
  const { favorites: headerFavorites, add: addHeaderFavorite, reorder: reorderHeaderFavorites } = useHeaderFavorites();
  const { visible: headerFavoritesBarVisible } = useHeaderFavoritesBarVisible();
  const { items: downloadItems } = useDownloads();
  const activeDownloadCount = downloadItems.filter((d) => d.state === "progressing").length;
  const { order: toolbarIconOrder, moveIcon: moveToolbarIcon } = useToolbarIconOrder();
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
  const { profiles, active: activeIdentity, activeProfile, isGuest, createSimpleProfile, removeProfile, syncNow, openProfileInNewWindow, openGuestInNewWindow } = useProfiles();
  const { minimize, toggleMaximize, close: closeWindow, isMaximized, setFullScreen, getIsFullscreen, onShortcutF11, onShortcutEscape, onShortcutFocusUrlBar, onShortcutAddFavorite, onShortcutOpenPasswordSettings, onFullscreenChanged } = useWindowControls();

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
  const [urlDraft, setUrlDraft] = useState("");
  const [homeUrlDraft, setHomeUrlDraft] = useState("");
  const [secondaryHomeUrlDraft, setSecondaryHomeUrlDraft] = useState("");
  const [urlCopied, setUrlCopied] = useState(false);
  const [autoSavedPill, setAutoSavedPill] = useState<{ url: string; username: string } | null>(null);

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

  const anyDialogOpen = dialogOpen || profilePopupOpen;
  // Dialogs have their own full-screen dark backdrop — but that backdrop is
  // DOM, and native content always paints above ALL DOM regardless, so it
  // can't actually show the page dimmed-but-visible underneath either.
  // Hiding here isn't "lossless", it's the same trade-off as everywhere
  // else, just applied to the whole window instead of a corner. Settings
  // itself is no longer a dialog at all now — it's regular tab content
  // (see isSettings above), so it never needs this in the first place.
  const nativeShouldHide = anyDialogOpen;

  const [editingUrl, setEditingUrl] = useState(false);
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
      setBounds({
        x: Math.round(rect.x + inset.left),
        y: Math.round(rect.y + inset.top),
        width: Math.round(Math.max(0, rect.width - inset.left - inset.right)),
        height: Math.round(Math.max(0, rect.height - inset.top - inset.bottom)),
      });
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

  // Confirmation pill for a password that was just auto-saved from a
  // browsed page's login form (see tab-preload.ts's submit listener) —
  // shows briefly in place of the toolbar, then clears itself.
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
      if (chromeHidden) exitChrome();
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
    const unsubOpenPasswordSettings = onShortcutOpenPasswordSettings(() => goToSettings("passwords"));
    return () => {
      unsubF11();
      unsubEsc();
      unsubFocusUrlBar();
      unsubAddFavorite();
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
          activeId={activeId}
          loadingTabIds={loadingHomeTabs}
          onSelect={(id) => switchTab(id)}
          onClose={(id) => closeTab(id)}
          onNewTab={() => newTab()}
          onLogoClick={openQuecksilverWebsite}
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

        <div className="flex max-w-[900px] flex-1 items-center gap-2.5 rounded-full py-[6px] pl-4 pr-2.5 transition-shadow focus-within:ring-2 focus-within:ring-[var(--brand)]" style={{ background: "var(--chrome-field)" }}>
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
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitUrl(urlDraft);
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
            placeholder="Search or enter web address"
          />
          <button
            onClick={starCurrentPage}
            aria-label="Add to favorites"
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-foreground/10 ${starFlash ? "text-foreground" : "text-muted-foreground"}`}
          >
            <Star className="h-[17px] w-[17px]" strokeWidth={1.5} fill={starFlash ? "currentColor" : "none"} />
          </button>
        </div>

        <div className="ml-1.5 flex items-center">
          {/* Auto-save confirmation — replaces the icons + profile pill
              (not the whole toolbar, and never covers the search bar)
              while it's showing, then reverts back. */}
          {autoSavedPill ? (
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
                  className="ml-2 flex h-8 items-center gap-2 rounded-full bg-card pl-1 pr-4 text-[13px] font-semibold text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-muted">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  Signing in…
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ) : isGuest ? (
                <button
                  onClick={() => setProfilePopupOpen(true)}
                  className="ml-2 flex h-8 items-center gap-2 rounded-full bg-card pl-1 pr-4 text-[13px] font-semibold text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-muted">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  Guest
                </button>
              ) : activeProfile ? (
                <button
                  onClick={() => setProfilePopupOpen(true)}
                  className="ml-2 flex h-8 items-center gap-2 rounded-full bg-card pl-1 pr-4 shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                >
                  <span
                    className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: activeProfile.kind === "quecksilver" ? "var(--brand)" : "hsl(240 4% 46%)" }}
                  >
                    {(activeProfile.kind === "quecksilver" ? activeProfile.email : activeProfile.name)?.charAt(0).toUpperCase() ?? "?"}
                  </span>
                  <span className="text-[13px] font-semibold text-foreground">
                    {activeProfile.kind === "quecksilver" && activeProfile.email ? nameFromEmail(activeProfile.email) : activeProfile.name}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => setProfilePopupOpen(true)}
                  disabled={!isElectron}
                  className="ml-2 flex h-8 items-center gap-2 rounded-full bg-card pl-1 pr-4 text-[13px] font-semibold text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.15)] disabled:opacity-50"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-muted">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  Sign in
                </button>
              )}
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
                  <ZoomedContent className="relative flex h-full flex-col overflow-hidden">
                    {isHome && !isHomeLoading && (
                      <HomeContent
                        urlDraft={homeUrlDraft}
                        onUrlDraftChange={setHomeUrlDraft}
                        onSubmit={submitUrl}
                        bookmarks={bookmarks}
                        onOpenBookmark={(url) => openBookmark(url)}
                        onOpenSlot={openSlot}
                        onRemoveSlot={remove}
                      />
                    )}
                    {isSettings && <SettingsView />}
                  </ZoomedContent>
                </ResizablePanel>
                <ResizableHandle withHandle className="[-webkit-app-region:no-drag]" />
                <ResizablePanel defaultSize={50} minSize={15}>
                  <ZoomedContent className="relative flex h-full flex-col overflow-hidden bg-background">
                    {secondaryTab?.isSettings && <SettingsView />}
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
                      />
                    )}
                    {/* Neither home nor settings — a real page, shown by the
                        native view the backend positions into this exact
                        half (see applySplitLayout in tab-manager.ts). */}
                  </ZoomedContent>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <ZoomedContent className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
                {isHome && !isHomeLoading && (
                  <HomeContent
                    urlDraft={homeUrlDraft}
                    onUrlDraftChange={setHomeUrlDraft}
                    onSubmit={submitUrl}
                    bookmarks={bookmarks}
                    onOpenBookmark={(url) => openBookmark(url)}
                    onOpenSlot={openSlot}
                    onRemoveSlot={remove}
                  />
                )}
                {isSettings && <SettingsView />}
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
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bm-label">Name</Label>
              <Input id="bm-label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bm-url">URL</Label>
              <Input id="bm-url" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Profiles */}
      <ProfilePopup
        open={profilePopupOpen}
        onOpenChange={setProfilePopupOpen}
        profiles={profiles}
        active={activeIdentity}
        onOpenProfileInNewWindow={(id) => openProfileInNewWindow(id)}
        onOpenGuestInNewWindow={() => openGuestInNewWindow()}
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

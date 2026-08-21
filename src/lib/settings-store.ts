import { useCallback, useEffect, useState } from "react";

// Small localStorage-backed settings — genuinely persisted, no Electron
// round-trip needed for plain UI preferences like these.
export type SearchEngine =
  | "google"
  | "bing"
  | "duckduckgo"
  | "startpage"
  | "mojeek"
  | "ecosia"
  | "brave"
  | "yahoo"
  | "yandex"
  | "qwant"
  | "swisscows"
  | "presearch"
  | "you"
  | "perplexity";

export const SEARCH_ENGINES: { id: SearchEngine; label: string; domain: string; buildUrl: (q: string) => string }[] = [
  { id: "google", label: "Google", domain: "google.com", buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { id: "bing", label: "Bing", domain: "bing.com", buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  { id: "duckduckgo", label: "DuckDuckGo", domain: "duckduckgo.com", buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  { id: "startpage", label: "Startpage", domain: "startpage.com", buildUrl: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
  { id: "brave", label: "Brave Search", domain: "search.brave.com", buildUrl: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  { id: "mojeek", label: "Mojeek", domain: "mojeek.com", buildUrl: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}` },
  { id: "ecosia", label: "Ecosia", domain: "ecosia.org", buildUrl: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}` },
  { id: "qwant", label: "Qwant", domain: "qwant.com", buildUrl: (q) => `https://www.qwant.com/?q=${encodeURIComponent(q)}` },
  { id: "swisscows", label: "Swisscows", domain: "swisscows.com", buildUrl: (q) => `https://swisscows.com/en/web?query=${encodeURIComponent(q)}` },
  { id: "yahoo", label: "Yahoo", domain: "yahoo.com", buildUrl: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}` },
  { id: "yandex", label: "Yandex", domain: "yandex.com", buildUrl: (q) => `https://yandex.com/search/?text=${encodeURIComponent(q)}` },
  { id: "you", label: "You.com", domain: "you.com", buildUrl: (q) => `https://you.com/search?q=${encodeURIComponent(q)}` },
  { id: "presearch", label: "Presearch", domain: "presearch.com", buildUrl: (q) => `https://presearch.com/search?q=${encodeURIComponent(q)}` },
  { id: "perplexity", label: "Perplexity", domain: "perplexity.ai", buildUrl: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}` },
];

const SEARCH_ENGINE_KEY = "qs-search-engine";

export function getSearchEngine(): SearchEngine {
  if (typeof window === "undefined") return "google";
  return (window.localStorage.getItem(SEARCH_ENGINE_KEY) as SearchEngine) || "google";
}

export function useSearchEngine() {
  const [engine, setEngineState] = useState<SearchEngine>(getSearchEngine());
  const setEngine = useCallback((id: SearchEngine) => {
    setEngineState(id);
    window.localStorage.setItem(SEARCH_ENGINE_KEY, id);
  }, []);
  return { engine, setEngine };
}

// Order of the Edit/Settings/Download/Split toolbar icons — draggable to
// rearrange (see the toolbar in routes/index.tsx), persisted so it sticks
// across restarts.
export type ToolbarIconId = "edit" | "settings" | "download" | "split" | "pip";
const TOOLBAR_ORDER_KEY = "qs-toolbar-icon-order-v2b";
const DEFAULT_TOOLBAR_ORDER: ToolbarIconId[] = ["edit", "download", "pip", "settings", "split"];

export function useToolbarIconOrder() {
  const [order, setOrder] = useState<ToolbarIconId[]>(() => {
    if (typeof window === "undefined") return DEFAULT_TOOLBAR_ORDER;
    try {
      const raw = window.localStorage.getItem(TOOLBAR_ORDER_KEY);
      const parsed = raw ? (JSON.parse(raw) as ToolbarIconId[]) : null;
      // Guards against a stale saved order missing an icon that got added
      // later, or listing one that no longer exists.
      if (parsed && DEFAULT_TOOLBAR_ORDER.every((id) => parsed.includes(id)) && parsed.length === DEFAULT_TOOLBAR_ORDER.length) {
        return parsed;
      }
    } catch {
      // fall through to default
    }
    return DEFAULT_TOOLBAR_ORDER;
  });

  useEffect(() => {
    window.localStorage.setItem(TOOLBAR_ORDER_KEY, JSON.stringify(order));
  }, [order]);

  const moveIcon = useCallback((dragId: ToolbarIconId, dropId: ToolbarIconId) => {
    setOrder((prev) => {
      const next = prev.filter((id) => id !== dragId);
      const dropIndex = next.indexOf(dropId);
      next.splice(dropIndex, 0, dragId);
      return next;
    });
  }, []);

  return { order, moveIcon };
}

// Page zoom — the default zoom for newly opened tabs that haven't been
// manually zoomed via Ctrl+wheel/pinch. Independent from the interactive
// Ctrl+wheel/pinch zoom on Start/Settings themselves (see use-page-zoom.ts)
// — the two were briefly merged into one value, but that made them fight
// over the same state.
//
// Cross-instance sync via a custom event: every place that calls
// useZoomLevel() holds its own useState — without the event, a change from
// one instance never reached another already-mounted one, which looked
// like "the zoom setting does nothing" even though it was actually just
// not being read anywhere else.
const ZOOM_KEY = "qs-page-zoom";
const ZOOM_CHANGED_EVENT = "qs-page-zoom-changed";
export const ZOOM_LEVELS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200];

function readZoomLevel(): number {
  if (typeof window === "undefined") return 100;
  return Number(window.localStorage.getItem(ZOOM_KEY)) || 100;
}

export function useZoomLevel() {
  const [level, setLevelState] = useState<number>(readZoomLevel);

  useEffect(() => {
    const onChange = () => setLevelState(readZoomLevel());
    window.addEventListener(ZOOM_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ZOOM_CHANGED_EVENT, onChange);
  }, []);

  const setLevel = useCallback((next: number) => {
    window.localStorage.setItem(ZOOM_KEY, String(next));
    window.dispatchEvent(new Event(ZOOM_CHANGED_EVENT));
  }, []);
  return { level, setLevel };
}

// Text size — applied as a scale factor on the chrome UI's own root font
// size (not the browsed pages, which have their own separate zoom below).
const TEXT_SCALE_KEY = "qs-text-scale";

export function useTextScale() {
  const [scale, setScaleState] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    return Number(window.localStorage.getItem(TEXT_SCALE_KEY)) || 1;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(scale));
  }, [scale]);

  const setScale = useCallback((next: number) => {
    setScaleState(next);
    window.localStorage.setItem(TEXT_SCALE_KEY, String(next));
  }, []);

  return { scale, setScale };
}

// Whether the header favorites bar (the row of bookmark chips under the
// header, separate from the 5 home-page slots) renders at all — toggled
// from Settings next to "Add favorite". Independent from the favorites
// list itself: turning this off just hides the bar, it doesn't touch any
// saved favorite.
//
// Settings and the main window (routes/index.tsx) each hold their own
// separate useState instance of this hook — localStorage alone doesn't
// notify other already-mounted instances when one of them writes, so
// toggling in Settings silently did nothing to the bar actually shown in
// the header. A custom window event keeps every instance in sync.
const HEADER_FAVORITES_VISIBLE_KEY = "qs-header-favorites-visible";
const HEADER_FAVORITES_VISIBLE_EVENT = "qs-header-favorites-visible-changed";

function readHeaderFavoritesBarVisible(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(HEADER_FAVORITES_VISIBLE_KEY);
  return raw === null ? true : raw === "1";
}

export function useHeaderFavoritesBarVisible() {
  const [visible, setVisibleState] = useState<boolean>(readHeaderFavoritesBarVisible);

  useEffect(() => {
    const onChange = () => setVisibleState(readHeaderFavoritesBarVisible());
    window.addEventListener(HEADER_FAVORITES_VISIBLE_EVENT, onChange);
    return () => window.removeEventListener(HEADER_FAVORITES_VISIBLE_EVENT, onChange);
  }, []);

  const setVisible = useCallback((next: boolean) => {
    window.localStorage.setItem(HEADER_FAVORITES_VISIBLE_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(HEADER_FAVORITES_VISIBLE_EVENT));
  }, []);

  return { visible, setVisible };
}

// Whether tabs render as a vertical list in a left-hand sidebar (pushing
// page content over) instead of the classic horizontal strip along the
// top. Toggled from the tabs-menu dropdown (TabsMenuContent, opened via
// the chevron button that replaced the old logo button in TabStrip) —
// same cross-instance-sync reasoning as useHeaderFavoritesBarVisible
// above, since the main window and any overlay content reading this
// value are separate React trees.
const VERTICAL_TABS_ENABLED_KEY = "qs-vertical-tabs-enabled";
const VERTICAL_TABS_ENABLED_EVENT = "qs-vertical-tabs-enabled-changed";

function readVerticalTabsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(VERTICAL_TABS_ENABLED_KEY) === "1";
}

export function useVerticalTabsEnabled() {
  const [enabled, setEnabledState] = useState<boolean>(readVerticalTabsEnabled);

  useEffect(() => {
    const onChange = () => setEnabledState(readVerticalTabsEnabled());
    window.addEventListener(VERTICAL_TABS_ENABLED_EVENT, onChange);
    return () => window.removeEventListener(VERTICAL_TABS_ENABLED_EVENT, onChange);
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    window.localStorage.setItem(VERTICAL_TABS_ENABLED_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(VERTICAL_TABS_ENABLED_EVENT));
  }, []);

  return { enabled, setEnabled };
}

// Whether the vertical tabs sidebar is pinned open (pushes page content
// over, same as before) or unpinned (rests collapsed as a slim rail and
// only expands as a hover-over overlay that does NOT push content — it
// layers on top instead, so nothing shifts until the person pins it
// again). Defaults to pinned so existing behavior doesn't change for
// anyone who already had vertical tabs on before this setting existed.
const VERTICAL_TABS_PINNED_KEY = "qs-vertical-tabs-pinned";
const VERTICAL_TABS_PINNED_EVENT = "qs-vertical-tabs-pinned-changed";

function readVerticalTabsPinned(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(VERTICAL_TABS_PINNED_KEY);
  return raw === null ? true : raw === "1";
}

export function useVerticalTabsPinned() {
  const [pinned, setPinnedState] = useState<boolean>(readVerticalTabsPinned);

  useEffect(() => {
    const onChange = () => setPinnedState(readVerticalTabsPinned());
    window.addEventListener(VERTICAL_TABS_PINNED_EVENT, onChange);
    return () => window.removeEventListener(VERTICAL_TABS_PINNED_EVENT, onChange);
  }, []);

  const setPinned = useCallback((next: boolean) => {
    window.localStorage.setItem(VERTICAL_TABS_PINNED_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(VERTICAL_TABS_PINNED_EVENT));
  }, []);

  return { pinned, setPinned };
}

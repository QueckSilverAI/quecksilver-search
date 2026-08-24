import { getSearchEngine, getOnionize, SEARCH_ENGINES } from "./settings-store";

// Official, current (v3) DuckDuckGo Tor onion service — verified, not a
// placeholder. Only reachable at all when traffic is actually routed
// through Tor, which is why the "Onionize" toggle (HomeContent.tsx) only
// shows up in a Tor window in the first place — applying it in a normal
// window would just be a dead .onion address that can't resolve.
const DUCKDUCKGO_ONION_BASE = "http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion";

// Same shape-check parseUrlBarInput below uses to decide "URL vs. search
// engine" — pulled out standalone so callers that only need a yes/no (e.g.
// "should the address bar show this domain's favicon right now?") don't
// have to run the search-engine URL-building machinery just to throw the
// result away.
export function isLikelyDirectUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(value);
}

// The URL bar now also accepts plain search queries — anything that isn't a
// recognizable URL/domain falls back to the configured search engine
// (Settings → Search engine), same as a normal browser's combined
// address/search bar.
export function parseUrlBarInput(raw: string, isTorWindow = false): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      return new URL(value).toString();
    } catch {
      return null;
    }
  }

  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)) {
    return `http://${value}`;
  }

  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(value)) {
    try {
      return new URL(`https://${value}`).toString();
    } catch {
      return null;
    }
  }

  const engineId = getSearchEngine();
  // Onionize only actually applies in a Tor window (a normal window has
  // no route to a .onion address at all) and only for DuckDuckGo (the
  // only engine here with a real onion service) — the toggle itself is
  // only ever shown under those same two conditions, but this is checked
  // again here rather than trusting that, since the setting is global
  // and persists even after leaving a Tor window.
  if (isTorWindow && engineId === "duckduckgo" && getOnionize()) {
    return `${DUCKDUCKGO_ONION_BASE}/?q=${encodeURIComponent(value)}`;
  }
  const engine = SEARCH_ENGINES.find((e) => e.id === engineId) ?? SEARCH_ENGINES[0]!;
  return engine.buildUrl(value);
}

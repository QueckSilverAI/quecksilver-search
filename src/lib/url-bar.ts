import { getSearchEngine, SEARCH_ENGINES } from "./settings-store";

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
export function parseUrlBarInput(raw: string): string | null {
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

  const engine = SEARCH_ENGINES.find((e) => e.id === getSearchEngine()) ?? SEARCH_ENGINES[0]!;
  return engine.buildUrl(value);
}

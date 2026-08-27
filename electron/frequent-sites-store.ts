import { ProfileScopedStore } from "./profile-scoped-store";

// Powers the URL-bar autocomplete in routes/index.tsx — deliberately NOT a
// history log. Only ever stores a domain and how many times it's been
// visited (plus lastVisit purely to break ties in sort order), never a
// full URL, path, query string, or per-visit timestamp. That's what keeps
// this from becoming the browsing history this app is explicitly designed
// not to have — you can tell "google.com is visited a lot" from this file,
// never "what pages, when".
export type FrequentSite = { domain: string; visitCount: number; lastVisit: number };

const store = new ProfileScopedStore<FrequentSite[]>("frequent-sites.json", []);

export function recordVisit(windowId: number, url: string) {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return; // not a real http(s) URL (about:blank, a data: URL, ...) — nothing to record
  }
  if (!hostname) return;
  const sites = store.read(windowId, []);
  const existing = sites.find((s) => s.domain === hostname);
  if (existing) {
    existing.visitCount += 1;
    existing.lastVisit = Date.now();
  } else {
    sites.push({ domain: hostname, visitCount: 1, lastVisit: Date.now() });
  }
  // Capped — this is meant to surface genuinely frequent sites, not grow
  // forever. Drops the least-visited, least-recent entries first.
  if (sites.length > 200) {
    sites.sort((a, b) => b.visitCount - a.visitCount || b.lastVisit - a.lastVisit);
    sites.length = 200;
  }
  store.write(windowId, sites);
  // Temporary diagnostic.
  console.log(`[frequent-sites] recorded visit to ${hostname} (count now ${existing ? existing.visitCount : 1})`);
}

export function listFrequentSites(windowId: number, prefix: string, limit = 5): FrequentSite[] {
  const needle = prefix.trim().toLowerCase();
  if (!needle) return [];
  const all = store.read(windowId, []);
  // startsWith, not includes — the URL-bar caller does INLINE completion
  // (the matched domain's remaining characters get appended straight into
  // the field, pre-selected), which only makes sense for an actual prefix
  // match. With includes(), a high-visit-count domain that merely
  // CONTAINS the typed text anywhere (not at the start) could out-rank a
  // genuine prefix match in the sort below and take the one slot the
  // caller actually checks (routes/index.tsx only looks at results[0]) —
  // silently swallowing a real, valid suggestion for that keystroke since
  // the caller's own startsWith guard then rejects the non-prefix top
  // result and shows nothing at all.
  const results = all
    .filter((s) => s.domain.toLowerCase().startsWith(needle))
    .sort((a, b) => b.visitCount - a.visitCount || b.lastVisit - a.lastVisit)
    .slice(0, limit);
  // Temporary diagnostic.
  console.log(`[frequent-sites] list("${prefix}") — ${all.length} sites stored total, ${results.length} matched: ${results.map((r) => r.domain).join(", ")}`);
  return results;
}

// For Zora's list_frequent_sites tool — the URL-bar autocomplete above
// needs a prefix (nothing typed yet = nothing to suggest), but "what
// sites do I visit a lot" is a sensible question with no prefix at all.
export function listTopFrequentSites(windowId: number, limit = 15): FrequentSite[] {
  return store
    .read(windowId, [])
    .slice()
    .sort((a, b) => b.visitCount - a.visitCount || b.lastVisit - a.lastVisit)
    .slice(0, limit);
}

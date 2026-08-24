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
  const results = all
    .filter((s) => s.domain.toLowerCase().includes(needle))
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

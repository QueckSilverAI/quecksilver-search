// In-memory counter for how many ad/tracker requests privacy.ts's
// existing BLOCKED_HOSTS check has cancelled, per tab — backs the
// Control center's "Tracker blockiert" line (masterplan #5).
//
// Kept as its own tiny module, keyed by Electron's numeric
// webContents.id, rather than folded into tab-manager.ts's
// consoleErrorCounts (keyed by this app's own string tabId): the
// increment happens inside privacy.ts's session-level
// webRequest.onBeforeRequest hook, which only ever sees
// details.webContentsId, not this app's tabId — importing tab-manager.ts
// from privacy.ts just to resolve that id would be a real circular-import
// risk (tab-manager.ts already imports FROM privacy-settings-store.ts).
// tab-manager.ts instead reads this store keyed by its own
// view.webContents.id, same pattern as everywhere else here.
const trackerCounts = new Map<number, number>();
// For Zora's list_trackers_on_page tool — same key, a capped set of the
// distinct hostnames actually blocked (not every request; a tracker
// pinged 40 times on one page is one name, not 40). Reset/cleared
// alongside the count below.
const trackerHostnames = new Map<number, Set<string>>();
const MAX_TRACKER_NAMES = 25;

export function incrementTrackerCount(webContentsId: number, hostname?: string) {
  trackerCounts.set(webContentsId, (trackerCounts.get(webContentsId) ?? 0) + 1);
  if (hostname) {
    const names = trackerHostnames.get(webContentsId) ?? new Set<string>();
    if (names.size < MAX_TRACKER_NAMES) names.add(hostname);
    trackerHostnames.set(webContentsId, names);
  }
}

export function getTrackerCount(webContentsId: number): number {
  return trackerCounts.get(webContentsId) ?? 0;
}

export function getTrackerHostnames(webContentsId: number): string[] {
  return [...(trackerHostnames.get(webContentsId) ?? [])];
}

export function resetTrackerCount(webContentsId: number) {
  trackerCounts.set(webContentsId, 0);
  trackerHostnames.delete(webContentsId);
}

export function clearTrackerCount(webContentsId: number) {
  trackerCounts.delete(webContentsId);
  trackerHostnames.delete(webContentsId);
}

export function getTotalTrackerCount(): number {
  let total = 0;
  for (const n of trackerCounts.values()) total += n;
  return total;
}

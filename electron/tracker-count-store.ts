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

export function incrementTrackerCount(webContentsId: number) {
  trackerCounts.set(webContentsId, (trackerCounts.get(webContentsId) ?? 0) + 1);
}

export function getTrackerCount(webContentsId: number): number {
  return trackerCounts.get(webContentsId) ?? 0;
}

export function resetTrackerCount(webContentsId: number) {
  trackerCounts.set(webContentsId, 0);
}

export function clearTrackerCount(webContentsId: number) {
  trackerCounts.delete(webContentsId);
}

export function getTotalTrackerCount(): number {
  let total = 0;
  for (const n of trackerCounts.values()) total += n;
  return total;
}

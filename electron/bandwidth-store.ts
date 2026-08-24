// In-memory byte counter for how much a tab has loaded — backs the
// Control center's "Bandbreiten-Nutzung" line (masterplan #10). Same
// shape/reasoning as tracker-count-store.ts: keyed by Electron's numeric
// webContents.id since that's all privacy.ts's session-level webRequest
// hook ever sees, resolved back to this app's own string tabId by
// tab-manager.ts the same way it already does for tracker counts.
const bandwidthBytes = new Map<number, number>();

export function addBandwidthBytes(webContentsId: number, bytes: number) {
  if (!bytes || bytes < 0) return;
  bandwidthBytes.set(webContentsId, (bandwidthBytes.get(webContentsId) ?? 0) + bytes);
}

export function getBandwidthBytes(webContentsId: number): number {
  return bandwidthBytes.get(webContentsId) ?? 0;
}

export function resetBandwidthBytes(webContentsId: number) {
  bandwidthBytes.set(webContentsId, 0);
}

export function clearBandwidthBytes(webContentsId: number) {
  bandwidthBytes.delete(webContentsId);
}

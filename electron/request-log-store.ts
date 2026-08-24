// Netzwerk-Request-Log (masterplan #26) — last ~30 completed requests per
// tab, keyed by webContents.id same as tracker-count-store.ts/
// bandwidth-store.ts (privacy.ts's webRequest hooks only ever see that
// numeric id, not this app's own string tabId). A plain ring buffer, not
// a live push channel — see this file's header note in the masterplan:
// "braucht eigenen Push-Kanal" was the plan's suggestion, but this app
// already has a working "poll every few seconds while the panel might be
// showing" pattern for every other live Control center number (bandwidth,
// RAM/CPU, ...), so the log is just read fresh on each poll instead of a
// separate IPC channel.
export type RequestLogEntry = {
  url: string;
  method: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
};

const MAX_ENTRIES = 30;
const logs = new Map<number, RequestLogEntry[]>();
// requestId (Electron's per-request numeric id, unique for the lifetime
// of that request) -> the timestamp it started, so onCompleted can
// compute a duration. Cleared as soon as it's consumed.
const startTimes = new Map<number, number>();

export function recordRequestStart(requestId: number, timestamp: number) {
  startTimes.set(requestId, timestamp);
}

export function recordRequestCompleted(
  webContentsId: number,
  requestId: number,
  entry: Omit<RequestLogEntry, "durationMs">,
) {
  const startedAt = startTimes.get(requestId);
  startTimes.delete(requestId);
  const durationMs = startedAt ? Math.max(0, Math.round(entry.timestamp - startedAt)) : 0;
  const list = logs.get(webContentsId) ?? [];
  list.push({ ...entry, durationMs });
  if (list.length > MAX_ENTRIES) list.shift();
  logs.set(webContentsId, list);
}

export function getRequestLog(webContentsId: number): RequestLogEntry[] {
  return logs.get(webContentsId) ?? [];
}

export function clearRequestLog(webContentsId: number) {
  logs.delete(webContentsId);
}

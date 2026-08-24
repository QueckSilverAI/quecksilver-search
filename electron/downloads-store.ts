import { app, session } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { JsonStore } from "./json-store";
import type { DownloadItem } from "./types";

const store = new JsonStore<DownloadItem[]>("downloads.json");
const FOLDER_KEY_STORE = new JsonStore<{ folder: string }>("downloads-folder.json");
const MAX_ENTRIES = 200; // oldest entries trimmed past this, keeps the file small

export function listDownloads(): DownloadItem[] {
  return store.read([]);
}

export function getDownloadsFolder(): string {
  const saved = FOLDER_KEY_STORE.read({ folder: "" }).folder;
  return saved || app.getPath("downloads");
}

export function setDownloadsFolder(folder: string) {
  FOLDER_KEY_STORE.write({ folder });
}

export function removeDownload(id: string) {
  const items = listDownloads().filter((d) => d.id !== id);
  store.write(items);
}

// Populated by registerDownloadTracking below, so cancelDownload() (used
// by Zora's cancel_download tool) can reach the live Electron.DownloadItem
// — the persisted DownloadItem record above has no handle back to the
// real in-progress download, only its last-known snapshot. Cleared once a
// download finishes (done/updated-to-a-final-state), so this map only
// ever holds genuinely cancellable downloads.
const liveDownloads = new Map<string, Electron.DownloadItem>();

export function cancelDownload(id: string): boolean {
  const item = liveDownloads.get(id);
  if (!item) return false;
  item.cancel();
  return true;
}

function addOrUpdate(item: DownloadItem) {
  const items = listDownloads();
  const idx = items.findIndex((d) => d.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.unshift(item);
  store.write(items.slice(0, MAX_ENTRIES));
}

// Hooked up once per session — every real download (any tab) fires
// will-download on the session's downloads, not per-WebContents, so this
// only needs registering once regardless of how many tabs exist.
export function registerDownloadTracking(onChanged: () => void) {
  session.defaultSession.on("will-download", (_event, item) => {
    const folder = getDownloadsFolder();
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
    const savePath = path.join(folder, item.getFilename());
    item.setSavePath(savePath);

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: DownloadItem = {
      id,
      filename: item.getFilename(),
      path: savePath,
      state: "progressing",
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now(),
    };
    addOrUpdate(record);
    onChanged();
    liveDownloads.set(id, item);

    item.on("updated", (_e, state) => {
      // item.getSavePath() — not the `savePath` we requested up front — is
      // the actual final location Electron/Chromium is writing to. Usually
      // identical to our request, but not guaranteed: this is exactly what
      // silently went stale for zip downloads specifically (Chromium's
      // extra scrutiny for archive/executable-bearing files can still
      // rename or relocate the file even after setSavePath was called).
      // Trusting our own precomputed guess here is what caused "Open"
      // (shell.openPath, which checks the file really is there) to fail
      // with "path not found" while "Show in folder" (shell.showItemInFolder,
      // which just opens the containing directory regardless of whether the
      // exact file exists) kept working and masked the mismatch.
      addOrUpdate({ ...record, path: item.getSavePath() || record.path, state: state === "interrupted" ? "interrupted" : "progressing", receivedBytes: item.getReceivedBytes() });
      onChanged();
    });
    item.once("done", (_e, state) => {
      addOrUpdate({
        ...record,
        path: item.getSavePath() || record.path,
        state: state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted",
        receivedBytes: item.getReceivedBytes(),
      });
      liveDownloads.delete(id);
      onChanged();
    });
  });
}

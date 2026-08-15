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

    item.on("updated", (_e, state) => {
      addOrUpdate({ ...record, state: state === "interrupted" ? "interrupted" : "progressing", receivedBytes: item.getReceivedBytes() });
      onChanged();
    });
    item.once("done", (_e, state) => {
      addOrUpdate({ ...record, state: state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted", receivedBytes: item.getReceivedBytes() });
      onChanged();
    });
  });
}

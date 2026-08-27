import { app, BrowserWindow, session } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getSitePermission } from "./site-permissions-store";
import { JsonStore } from "./json-store";
import type { DownloadItem } from "./types";

// Chrome/Edge behavior: a colliding filename doesn't overwrite silently or
// fail — it gets " (2)", " (3)", ... inserted before the extension. Without
// this, item.setSavePath() below just pointed every same-named download at
// the exact same path, so a second download of "invoice.pdf" either
// silently clobbered the first file or (on platforms/situations where the
// underlying write can't replace an existing file) failed outright with
// nothing visibly saved — indistinguishable from "download did nothing".
function uniquifyPath(folder: string, filename: string): string {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let candidate = path.join(folder, filename);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = path.join(folder, `${base} (${n})${ext}`);
    n++;
  }
  return candidate;
}

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
  session.defaultSession.on("will-download", (event, item, webContents) => {
    // "Automatische Downloads" per-site permission (Settings → Site
    // permissions) — was defined end-to-end (store, IPC, UI toggle, Zora
    // tool) but nothing ever actually read it here, so it had zero effect
    // regardless of what a person set it to. Only enforced when the person
    // deliberately blocked it for this exact domain (autoDownloadsExplicit
    // — see its doc comment in site-permissions-store.ts): an ambient
    // "block" that only exists as a side effect of some unrelated
    // permission's default-block record must NOT start silently killing
    // that domain's downloads. Same shape as camera/mic below it in
    // privacy.ts: once explicitly blocked, ALL downloads from that domain
    // are stopped (not just automatic ones) until switched back to
    // "allow" — there's no reliable way from the main process to tell a
    // real click-triggered download apart from a script-triggered one, so
    // rather than guess we keep this consistent with how every other
    // per-site permission in the app already behaves.
    try {
      const domain = new URL(webContents.getURL()).hostname;
      const win = BrowserWindow.fromWebContents(webContents);
      const entry = win ? getSitePermission(win.id, domain) : null;
      if (entry?.autoDownloadsExplicit && entry.autoDownloads === "block") {
        event.preventDefault();
        return;
      }
    } catch {
      /* no valid origin (e.g. a data: URL download) — nothing to block against */
    }

    const folder = getDownloadsFolder();
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
    const savePath = uniquifyPath(folder, item.getFilename());
    item.setSavePath(savePath);

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: DownloadItem = {
      id,
      // The uniquified basename, not item.getFilename() — otherwise the
      // downloads list shows two entries both named "invoice.pdf" even
      // though the second one actually landed on disk as "invoice (2).pdf".
      filename: path.basename(savePath),
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

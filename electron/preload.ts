import { contextBridge, ipcRenderer } from "electron";
import type {
  ActiveIdentity,
  AuthSession,
  Bookmark,
  ContentBounds,
  DownloadItem,
  HeaderFavorite,
  PasswordEntry,
  PasswordImportResult,
  Profile,
  SessionRecovery,
  TabsSnapshot,
  ToolResult,
} from "./types";
import type { OverlayAction, OverlayAnchor, OverlayKind } from "./overlay-types";
import type { ControlCenterSettings, ControlCenterActionRequest } from "./control-center-store";
import type { AppContext } from "./build-app-context";
import type { ZoraSettings, ZoraPreset, ToolPermissionMode } from "./zora-settings-store";
import type { ZoraToolCatalogEntry } from "./zora-tool-catalog";
import type { AuditLogEntry } from "./browser-tools";

// Fetched synchronously, before anything else in this file runs — see
// main.ts's tabs:listSync handler for the full reasoning. use-browser-api.ts
// reads this as its very first React state instead of an empty
// placeholder, so the chrome UI's first paint already shows the real tabs
// (a torn-off tab included) rather than "New Tab" for the brief moment
// before the normal async tabs:list() call would otherwise resolve.
// ipcRenderer.sendSync blocks until main.ts responds — deliberately, this
// needs to happen before React ever renders, not just before the page is
// interactive.
const initialTabsSnapshot: TabsSnapshot = ipcRenderer.sendSync("tabs:listSync");
console.log("[tabs-list-sync] preload received initial snapshot:", initialTabsSnapshot.tabs.length, "tab(s)");

const tabs = {
  new: (url?: string): Promise<string> => ipcRenderer.invoke("tabs:new", url),
  previewBase64: (id: string): Promise<string | null> => ipcRenderer.invoke("tabs:previewBase64", id),
  close: (id: string): Promise<void> => ipcRenderer.invoke("tabs:close", id),
  switch: (id: string): Promise<void> => ipcRenderer.invoke("tabs:switch", id),
  list: (): Promise<TabsSnapshot> => ipcRenderer.invoke("tabs:list"),
  // Drag-reorder in the tab strip — newOrder is the full, final tab-id order
  // after a live drag finishes.
  reorder: (newOrder: string[]): Promise<void> => ipcRenderer.invoke("tabs:reorder", newOrder),
  // Tearing a tab out of the strip (dragged far enough vertically away from
  // it) into its own new window — screenX/screenY position that new
  // window under wherever the tab was dropped, same as Chrome/Edge.
  detachToWindow: (id: string, screenX: number, screenY: number): Promise<void> =>
    ipcRenderer.invoke("tabs:detachToWindow", id, screenX, screenY),
  navigate: (id: string, url: string): Promise<void> => ipcRenderer.invoke("tabs:navigate", id, url),
  goBack: (id: string): Promise<void> => ipcRenderer.invoke("tabs:goBack", id),
  goForward: (id: string): Promise<void> => ipcRenderer.invoke("tabs:goForward", id),
  reload: (id: string, ignoreCache?: boolean): Promise<void> => ipcRenderer.invoke("tabs:reload", id, ignoreCache),
  setBounds: (bounds: ContentBounds): Promise<void> => ipcRenderer.invoke("tabs:setBounds", bounds),
  setVisible: (visible: boolean): Promise<void> => ipcRenderer.invoke("tabs:setVisible", visible),
  // Only the Settings → Zoom default — the interactive Ctrl+wheel/pinch
  // zoom is handled entirely inside the main process (tab-manager.ts) via
  // Electron's native "zoom-changed" gesture event, no IPC round trip
  // needed for that per-scroll.
  setDefaultZoom: (factor: number): Promise<void> => ipcRenderer.invoke("tabs:setDefaultZoom", factor),
  enterSplit: (id: string): Promise<void> => ipcRenderer.invoke("tabs:enterSplit", id),
  exitSplit: (): Promise<void> => ipcRenderer.invoke("tabs:exitSplit"),
  setSplitRatio: (ratio: number): Promise<void> => ipcRenderer.invoke("tabs:setSplitRatio", ratio),
  onChanged: (cb: (state: TabsSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, state: TabsSnapshot) => cb(state);
    ipcRenderer.on("tabs:changed", listener);
    return () => ipcRenderer.removeListener("tabs:changed", listener);
  },
  // --- Tab groups ---------------------------------------------------------
  createGroup: (name: string, color: string): Promise<string | null> => ipcRenderer.invoke("tabs:createGroup", name, color),
  setGroup: (tabId: string, groupId: string | null): Promise<void> => ipcRenderer.invoke("tabs:setGroup", tabId, groupId),
  renameGroup: (groupId: string, name: string): Promise<void> => ipcRenderer.invoke("tabs:renameGroup", groupId, name),
  setGroupColor: (groupId: string, color: string): Promise<void> => ipcRenderer.invoke("tabs:setGroupColor", groupId, color),
  setGroupCollapsed: (groupId: string, collapsed: boolean): Promise<void> => ipcRenderer.invoke("tabs:setGroupCollapsed", groupId, collapsed),
  removeGroup: (groupId: string): Promise<void> => ipcRenderer.invoke("tabs:removeGroup", groupId),
  // --- Find-in-page ---------------------------------------------------------
  findInPage: (query: string, forward = true, findNext = false): Promise<void> => ipcRenderer.invoke("tabs:findInPage", query, forward, findNext),
  stopFindInPage: (): Promise<void> => ipcRenderer.invoke("tabs:stopFindInPage"),
  onFoundInPage: (cb: (result: { tabId: string; matches: number; activeMatchOrdinal: number }) => void): (() => void) => {
    const listener = (_event: unknown, result: { tabId: string; matches: number; activeMatchOrdinal: number }) => cb(result);
    ipcRenderer.on("tabs:foundInPage", listener);
    return () => ipcRenderer.removeListener("tabs:foundInPage", listener);
  },
  // --- Picture-in-Picture ---------------------------------------------------
  togglePiP: (): Promise<"entered" | "exited" | "no-video"> => ipcRenderer.invoke("tabs:togglePiP"),
  toggleNightMode: (): Promise<boolean> => ipcRenderer.invoke("tabs:toggleNightMode"),
  toggleNightModeFor: (id: string): Promise<boolean> => ipcRenderer.invoke("tabs:toggleNightModeFor", id),
  isNightMode: (id: string): Promise<boolean> => ipcRenderer.invoke("tabs:isNightMode", id),
  toggleMute: (id: string): Promise<void> => ipcRenderer.invoke("tabs:toggleMute", id),
  focusChrome: (): Promise<void> => ipcRenderer.invoke("tabs:focusChrome"),
  copySelectionFor: (tabId: string): Promise<void> => ipcRenderer.invoke("tabs:copySelectionFor", tabId),
};

const bookmarks = {
  list: (): Promise<Bookmark[]> => ipcRenderer.invoke("bookmarks:list"),
  save: (value: Bookmark[]): Promise<void> => ipcRenderer.invoke("bookmarks:save", value),
  onChanged: (cb: (value: Bookmark[]) => void): (() => void) => {
    const listener = (_event: unknown, value: Bookmark[]) => cb(value);
    ipcRenderer.on("bookmarks:changed", listener);
    return () => ipcRenderer.removeListener("bookmarks:changed", listener);
  },
};

const auth = {
  getSession: (): Promise<AuthSession> => ipcRenderer.invoke("auth:getSession"),
  // mode "new-profile" (default) creates a new QueckSilver-linked profile;
  // "reauth" refreshes the session for whichever profile is already active.
  login: (mode: "new-profile" | "reauth" = "new-profile"): Promise<AuthSession> => ipcRenderer.invoke("auth:login", mode),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke("auth:cancelLogin"),
  logout: (): Promise<void> => ipcRenderer.invoke("auth:logout"),
  onChanged: (cb: (session: AuthSession) => void): (() => void) => {
    const listener = (_event: unknown, session: AuthSession) => cb(session);
    ipcRenderer.on("auth:changed", listener);
    return () => ipcRenderer.removeListener("auth:changed", listener);
  },
};

const profiles = {
  list: (): Promise<Profile[]> => ipcRenderer.invoke("profiles:list"),
  getActive: (): Promise<ActiveIdentity> => ipcRenderer.invoke("profiles:getActive"),
  createSimple: (name: string): Promise<Profile> => ipcRenderer.invoke("profiles:createSimple", name),
  rename: (id: string, name: string): Promise<void> => ipcRenderer.invoke("profiles:rename", id, name),
  setActive: (id: string): Promise<void> => ipcRenderer.invoke("profiles:setActive", id),
  enterGuest: (): Promise<void> => ipcRenderer.invoke("profiles:enterGuest"),
  // Always opens a brand-new window already on the given identity — the
  // window this was called from keeps whatever it had active, untouched.
  openInNewWindow: (identity: ActiveIdentity): Promise<void> => ipcRenderer.invoke("profiles:openInNewWindow", identity),
  remove: (id: string): Promise<void> => ipcRenderer.invoke("profiles:remove", id),
  syncNow: (): Promise<boolean> => ipcRenderer.invoke("profiles:syncNow"),
  onChanged: (cb: (value: { profiles: Profile[]; active: ActiveIdentity }) => void): (() => void) => {
    const listener = (_event: unknown, value: { profiles: Profile[]; active: ActiveIdentity }) => cb(value);
    ipcRenderer.on("profiles:changed", listener);
    return () => ipcRenderer.removeListener("profiles:changed", listener);
  },
};

const passwords = {
  list: (): Promise<PasswordEntry[]> => ipcRenderer.invoke("passwords:list"),
  add: (url: string, username: string, password: string): Promise<PasswordEntry> => ipcRenderer.invoke("passwords:add", url, username, password),
  update: (id: string, url: string, username: string, password?: string): Promise<PasswordEntry | null> =>
    ipcRenderer.invoke("passwords:update", id, url, username, password),
  remove: (id: string): Promise<void> => ipcRenderer.invoke("passwords:remove", id),
  import: (browser: "chrome" | "edge", profileId: string): Promise<PasswordImportResult> => ipcRenderer.invoke("passwords:import", browser, profileId),
  onChanged: (cb: (value: PasswordEntry[]) => void): (() => void) => {
    const listener = (_event: unknown, value: PasswordEntry[]) => cb(value);
    ipcRenderer.on("passwords:changed", listener);
    return () => ipcRenderer.removeListener("passwords:changed", listener);
  },
  // Fired once per successful auto-save from a browsed page's login form
  // (see tab-preload.ts's submit listener) — drives the confirmation pill
  // in routes/index.tsx.
  onAutoSaved: (cb: (value: { url: string; username: string }) => void): (() => void) => {
    const listener = (_event: unknown, value: { url: string; username: string }) => cb(value);
    ipcRenderer.on("passwords:autoSaved", listener);
    return () => ipcRenderer.removeListener("passwords:autoSaved", listener);
  },
};

const headerFavorites = {
  list: (): Promise<HeaderFavorite[]> => ipcRenderer.invoke("headerFavorites:list"),
  save: (value: HeaderFavorite[]): Promise<void> => ipcRenderer.invoke("headerFavorites:save", value),
  onChanged: (cb: (value: HeaderFavorite[]) => void): (() => void) => {
    const listener = (_event: unknown, value: HeaderFavorite[]) => cb(value);
    ipcRenderer.on("headerFavorites:changed", listener);
    return () => ipcRenderer.removeListener("headerFavorites:changed", listener);
  },
};

const downloads = {
  list: (): Promise<DownloadItem[]> => ipcRenderer.invoke("downloads:list"),
  remove: (id: string): Promise<void> => ipcRenderer.invoke("downloads:remove", id),
  open: (filePath: string): Promise<void> => ipcRenderer.invoke("downloads:open", filePath),
  showInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke("downloads:showInFolder", filePath),
  getFolder: (): Promise<string> => ipcRenderer.invoke("downloads:getFolder"),
  openFolder: (): Promise<void> => ipcRenderer.invoke("downloads:openFolder"),
  pickFolder: (): Promise<string> => ipcRenderer.invoke("downloads:pickFolder"),
  onChanged: (cb: (items: DownloadItem[]) => void): (() => void) => {
    const listener = (_event: unknown, items: DownloadItem[]) => cb(items);
    ipcRenderer.on("downloads:changed", listener);
    return () => ipcRenderer.removeListener("downloads:changed", listener);
  },
};

const system = {
  isDefaultBrowser: (): Promise<boolean> => ipcRenderer.invoke("system:isDefaultBrowser"),
  setDefaultBrowser: (): Promise<void> => ipcRenderer.invoke("system:setDefaultBrowser"),
};

const importer = {
  listProfiles: (browser: "chrome" | "edge"): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke("import:listProfiles", browser),
  bookmarks: (browser: "chrome" | "edge", profileId: string): Promise<HeaderFavorite[] | null> => ipcRenderer.invoke("import:bookmarks", browser, profileId),
};

const session = {
  getRecovery: (): Promise<SessionRecovery> => ipcRenderer.invoke("session:getRecovery"),
  restoreAccepted: (): Promise<void> => ipcRenderer.invoke("session:restoreAccepted"),
  restoreDismissed: (): Promise<void> => ipcRenderer.invoke("session:restoreDismissed"),
  getRestoreOnStart: (): Promise<boolean> => ipcRenderer.invoke("session:getRestoreOnStart"),
  setRestoreOnStart: (value: boolean): Promise<void> => ipcRenderer.invoke("session:setRestoreOnStart", value),
};
const frequentSites = {
  list: (prefix: string): Promise<{ domain: string; visitCount: number; lastVisit: number }[]> =>
    ipcRenderer.invoke("frequentSites:list", prefix),
};
type PermissionKind = "camera" | "microphone" | "notifications" | "autoDownloads";
type PermissionState = "allow" | "block";
type SitePermissionEntry = { domain: string; camera: PermissionState; microphone: PermissionState; notifications: PermissionState; autoDownloads: PermissionState; updatedAt: number };
const permissions = {
  list: (): Promise<SitePermissionEntry[]> => ipcRenderer.invoke("permissions:list"),
  set: (domain: string, kind: PermissionKind, state: PermissionState): Promise<void> => ipcRenderer.invoke("permissions:set", domain, kind, state),
  remove: (domain: string): Promise<void> => ipcRenderer.invoke("permissions:remove", domain),
  // Cookies, localStorage, IndexedDB, caches, service workers — everything
  // that origin has stored locally, for both http/https. Separate from
  // remove() above: that only forgets the camera/mic/notification
  // allow-or-block choice itself, this clears what the site actually put
  // on disk.
  clearSiteData: (domain: string): Promise<void> => ipcRenderer.invoke("permissions:clearSiteData", domain),
};
type DohProvider = "off" | "cloudflare" | "quad9";
type PrivacySettings = {
  removeTrackingParams: boolean;
  httpsOnly: boolean;
  dohProvider: DohProvider;
  panicShortcut: string;
  phishingProtection: boolean;
  torBinaryPath: string;
  torSecurityLevel: "standard" | "safer" | "safest";
};
const privacy = {
  get: (): Promise<PrivacySettings> => ipcRenderer.invoke("privacy:get"),
  set: (patch: Partial<PrivacySettings>): Promise<PrivacySettings> => ipcRenderer.invoke("privacy:set", patch),
};
// Backs the top-left "Control center" dropdown (ControlCenterContent.tsx)
// — plain get/set for the persisted toggles, plus a single fire-and-forget
// "action" channel for one-shot commands that aren't a setting themselves
// (open devtools, take a screenshot, ...). Mirrors the tabs/privacy split
// above: settings vs. imperative commands.
const controlCenter = {
  get: (): Promise<ControlCenterSettings> => ipcRenderer.invoke("controlCenter:get"),
  set: (patch: Partial<ControlCenterSettings>): Promise<ControlCenterSettings> =>
    ipcRenderer.invoke("controlCenter:set", patch),
  action: (request: ControlCenterActionRequest): Promise<unknown> =>
    ipcRenderer.invoke("controlCenter:action", request),
  getConsoleErrorTotal: (): Promise<number> => ipcRenderer.invoke("controlCenter:consoleErrorTotal"),
  getTrackerCountForActiveTab: (): Promise<number> =>
    ipcRenderer.invoke("controlCenter:trackerCountForActiveTab"),
  getCurrentSiteSafety: (): Promise<"safe" | "suspicious" | "unknown"> =>
    ipcRenderer.invoke("controlCenter:currentSiteSafety"),
  getBandwidthForActiveTab: (): Promise<number> =>
    ipcRenderer.invoke("controlCenter:bandwidthForActiveTab"),
  getResourceUsageForActiveTab: (): Promise<{ cpuPercent: number; ramMb: number } | null> =>
    ipcRenderer.invoke("controlCenter:resourceUsageForActiveTab"),
  getCustomCssForActiveTab: (): Promise<{ domain: string; css: string } | null> =>
    ipcRenderer.invoke("controlCenter:customCssForActiveTab"),
};
type TorStatus =
  | { state: "stopped" }
  | { state: "starting"; bootstrapPercent: number; message: string }
  | { state: "ready"; socksPort: number }
  | { state: "error"; message: string };
const tor = {
  getStatus: (): Promise<TorStatus> => ipcRenderer.invoke("tor:getStatus"),
  newIdentity: (): Promise<void> => ipcRenderer.invoke("tor:newIdentity"),
  onStatusChanged: (cb: (status: TorStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: TorStatus) => cb(status);
    ipcRenderer.on("tor:statusChanged", listener);
    return () => ipcRenderer.removeListener("tor:statusChanged", listener);
  },
};
type LoadedExtension = { id: string; name: string; path: string; enabled: boolean };
const extensions = {
  list: (): Promise<LoadedExtension[]> => ipcRenderer.invoke("extensions:list"),
  addFromFolder: (): Promise<LoadedExtension | { error: string } | null> => ipcRenderer.invoke("extensions:addFromFolder"),
  remove: (id: string): Promise<void> => ipcRenderer.invoke("extensions:remove", id),
  setEnabled: (id: string, enabled: boolean): Promise<void> => ipcRenderer.invoke("extensions:setEnabled", id, enabled),
};
const appUpdate = {
  install: (): Promise<void> => ipcRenderer.invoke("app:installUpdate"),
  onReady: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("app:updateReady", listener);
    return () => ipcRenderer.removeListener("app:updateReady", listener);
  },
};
const images = {
  // tabId/isChromeUI let main.ts find the exact webContents that rendered
  // the image — needed to read a blob: URL's bytes back out of it (see
  // fetchImageBuffer in main.ts). Optional so nothing else calling these
  // breaks; main.ts just falls back to no source webContents (fine for
  // ordinary http(s)/data URLs, which don't need one).
  copy: (url: string, tabId?: string, isChromeUI?: boolean): Promise<void> =>
    ipcRenderer.invoke("images:copy", url, tabId, isChromeUI),
  save: (url: string, tabId?: string, isChromeUI?: boolean): Promise<void> =>
    ipcRenderer.invoke("images:save", url, tabId, isChromeUI),
  saveDirect: (url: string, tabId?: string, isChromeUI?: boolean): Promise<void> =>
    ipcRenderer.invoke("images:saveDirect", url, tabId, isChromeUI),
  copyLink: (url: string, tabId?: string, isChromeUI?: boolean): Promise<void> =>
    ipcRenderer.invoke("images:copyLink", url, tabId, isChromeUI),
};
const links = {
  copy: (url: string): Promise<void> => ipcRenderer.invoke("links:copy", url),
  openInNewTab: (url: string, tabId?: string, isChromeUI?: boolean): Promise<void> =>
    ipcRenderer.invoke("links:openInNewTab", url, tabId, isChromeUI),
  openInNewWindow: (url: string): Promise<void> => ipcRenderer.invoke("links:openInNewWindow", url),
  openInIncognitoWindow: (url: string): Promise<void> => ipcRenderer.invoke("links:openInIncognitoWindow", url),
  openHere: (tabId: string, url: string): Promise<void> => ipcRenderer.invoke("links:openHere", tabId, url),
  saveAs: (url: string): Promise<void> => ipcRenderer.invoke("links:saveAs", url),
};
const tools = {
  execute: (name: string, args: Record<string, unknown>): Promise<ToolResult> =>
    ipcRenderer.invoke("tools:execute", name, args),
};
const clipboardApi = {
  writeText: (text: string): Promise<void> => ipcRenderer.invoke("clipboard:writeText", text),
};
const zora = {
  // See electron/build-app-context.ts — called once per send() by
  // use-zora-chat.ts and attached to the request as `appContext`.
  getAppContext: (): Promise<AppContext | null> => ipcRenderer.invoke("zora:getAppContext"),
  // For read_page_aloud/stop_reading (electron/browser-tools.ts) — the
  // audio itself travels back as part of the normal tools:execute result
  // (see ToolResult's audioBase64), played locally by the renderer; this
  // is just the "stop now" signal going the other way, since stop_reading
  // runs in the main process and has no direct handle on the renderer's
  // <audio> element.
  onStopReading: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("zora:stopReading", handler);
    return () => ipcRenderer.removeListener("zora:stopReading", handler);
  },
  // Permission model (electron/zora-settings-store.ts /
  // zora-tool-catalog.ts) — used by both the Settings UI and
  // use-zora-chat.ts's per-tool gating.
  getSettings: (): Promise<ZoraSettings> => ipcRenderer.invoke("zora:getSettings"),
  setPreset: (preset: ZoraPreset): Promise<ZoraSettings> => ipcRenderer.invoke("zora:setPreset", preset),
  setScreenShareEnabled: (enabled: boolean): Promise<ZoraSettings> =>
    ipcRenderer.invoke("zora:setScreenShareEnabled", enabled),
  setToolPermission: (toolName: string, mode: ToolPermissionMode | null): Promise<ZoraSettings> =>
    ipcRenderer.invoke("zora:setToolPermission", toolName, mode),
  getEffectivePermissions: (): Promise<Record<string, ToolPermissionMode>> =>
    ipcRenderer.invoke("zora:getEffectivePermissions"),
  getToolCatalog: (): Promise<Record<string, ZoraToolCatalogEntry>> => ipcRenderer.invoke("zora:getToolCatalog"),
  getAuditLog: (): Promise<AuditLogEntry[]> => ipcRenderer.invoke("zora:getAuditLog"),
  clearAuditLog: (): Promise<void> => ipcRenderer.invoke("zora:clearAuditLog"),
  pickImageFile: (): Promise<{ name: string; mimeType: string; base64: string } | null> =>
    ipcRenderer.invoke("zora:pickImageFile"),
};
const searchEngine = {
  get: (): Promise<string> => ipcRenderer.invoke("searchEngine:get"),
  set: (engine: string): Promise<void> => ipcRenderer.invoke("searchEngine:set", engine),
  onChanged: (cb: (engine: string) => void): (() => void) => {
    const handler = (_e: unknown, engine: string) => cb(engine);
    ipcRenderer.on("searchEngine:changed", handler);
    return () => ipcRenderer.removeListener("searchEngine:changed", handler);
  },
};
const onionize = {
  get: (): Promise<boolean> => ipcRenderer.invoke("onionize:get"),
  set: (enabled: boolean): Promise<void> => ipcRenderer.invoke("onionize:set", enabled),
  onChanged: (cb: (enabled: boolean) => void): (() => void) => {
    const handler = (_e: unknown, enabled: boolean) => cb(enabled);
    ipcRenderer.on("onionize:changed", handler);
    return () => ipcRenderer.removeListener("onionize:changed", handler);
  },
};

const windowControls = {
  minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: (): Promise<void> => ipcRenderer.invoke("window:toggleMaximize"),
  close: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
  setFullScreen: (value: boolean): Promise<void> => ipcRenderer.invoke("window:setFullScreen", value),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke("window:isFullscreen"),
  onStateChanged: (cb: (state: { isMaximized: boolean }) => void): (() => void) => {
    const listener = (_event: unknown, state: { isMaximized: boolean }) => cb(state);
    ipcRenderer.on("window:stateChanged", listener);
    return () => ipcRenderer.removeListener("window:stateChanged", listener);
  },
  // Relayed from electron/main.ts's before-input-event listener — needed
  // because F11/Escape pressed while a real page (not our own chrome UI)
  // has keyboard focus never reaches a normal DOM keydown listener here at
  // all; that's a separate native content/input context entirely.
  onShortcutF11: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("shortcut:f11", listener);
    return () => ipcRenderer.removeListener("shortcut:f11", listener);
  },
  onShortcutEscape: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("shortcut:escape", listener);
    return () => ipcRenderer.removeListener("shortcut:escape", listener);
  },
  // Ctrl/Cmd+L — same relay reasoning as F11/Escape above. New tab, close
  // tab, reload, and tab-cycling (Ctrl+T/W/R/Tab) are handled directly in
  // main.ts against the TabManager and don't need a renderer round trip at
  // all; focusing the URL bar input can only happen here.
  onShortcutFocusUrlBar: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("shortcut:focusUrlBar", listener);
    return () => ipcRenderer.removeListener("shortcut:focusUrlBar", listener);
  },
  onShortcutAddFavorite: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("shortcut:addFavorite", listener);
    return () => ipcRenderer.removeListener("shortcut:addFavorite", listener);
  },
  onShortcutFindInPage: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("shortcut:findInPage", listener);
    return () => ipcRenderer.removeListener("shortcut:findInPage", listener);
  },
  onShortcutTabSearch: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("shortcut:tabSearch", listener);
    return () => ipcRenderer.removeListener("shortcut:tabSearch", listener);
  },
  onShortcutOpenPasswordSettings: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("shortcut:openPasswordSettings", listener);
    return () => ipcRenderer.removeListener("shortcut:openPasswordSettings", listener);
  },
  // Authoritative: fires whenever the window's real fullscreen state
  // changes, regardless of what triggered it — used to keep the chrome UI's
  // own hidden/shown state from ever drifting out of sync (see toggleChrome
  // in routes/index.tsx).
  onFullscreenChanged: (cb: (isFullscreen: boolean) => void): (() => void) => {
    const listener = (_event: unknown, isFullscreen: boolean) => cb(isFullscreen);
    ipcRenderer.on("window:fullscreenChanged", listener);
    return () => ipcRenderer.removeListener("window:fullscreenChanged", listener);
  },
};

// Opens/closes the native overlay window (Phase 1-3 of the plan) — the
// chrome UI just tells the main process WHAT to open and WHERE it's
// anchored; the overlay window's own content is a completely separate
// renderer (src/routes/overlay.tsx) that receives its payload over its own
// preload (overlay-preload.ts), not this one. The action a person picks in
// the overlay comes back here as "overlay:action" (main.ts's
// OverlayWindowManager forwards it to this exact window's webContents).
const overlay = {
  open: (kind: OverlayKind, payload: unknown, anchor: OverlayAnchor): Promise<void> => {
    if (kind === "downloads") console.log(`[downloads] preload's overlay.open("downloads", ...) called — sending overlay:open to main`);
    return ipcRenderer.invoke("overlay:open", kind, payload, anchor);
  },
  close: (): Promise<void> => ipcRenderer.invoke("overlay:close"),
  // See overlay-window.ts's update() — refreshes the payload of whichever
  // overlay is currently open (no-ops otherwise), without repositioning.
  update: (kind: OverlayKind, payload: unknown): Promise<void> => ipcRenderer.invoke("overlay:update", kind, payload),
  onAction: (cb: (action: OverlayAction) => void): (() => void) => {
    const listener = (_event: unknown, action: OverlayAction) => cb(action);
    ipcRenderer.on("overlay:action", listener);
    return () => ipcRenderer.removeListener("overlay:action", listener);
  },
};

contextBridge.exposeInMainWorld("browserAPI", {
  tabs,
  initialTabsSnapshot,
  bookmarks,
  headerFavorites,
  auth,
  profiles,
  passwords,
  tools,
  downloads,
  system,
  importer,
  session,
  frequentSites,
  images,
  links,
  permissions,
  extensions,
  appUpdate,
  privacy,
  controlCenter,
  tor,
  window: windowControls,
  overlay,
  zora,
  clipboard: clipboardApi,
  searchEngine,
  onionize,
});
contextBridge.exposeInMainWorld("platformInfo", { platform: process.platform });

export type BrowserAPI = {
  tabs: typeof tabs;
  bookmarks: typeof bookmarks;
  headerFavorites: typeof headerFavorites;
  auth: typeof auth;
  profiles: typeof profiles;
  passwords: typeof passwords;
  tools: typeof tools;
  session: typeof session;
  frequentSites: typeof frequentSites;
  images: typeof images;
  links: typeof links;
  permissions: typeof permissions;
  extensions: typeof extensions;
  appUpdate: typeof appUpdate;
  privacy: typeof privacy;
  controlCenter: typeof controlCenter;
  tor: typeof tor;
  window: typeof windowControls;
  overlay: typeof overlay;
  zora: typeof zora;
  clipboard: typeof clipboardApi;
  searchEngine: typeof searchEngine;
  onionize: typeof onionize;
};

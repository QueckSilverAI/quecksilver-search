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
  TabsSnapshot,
  ToolResult,
} from "./types";

const tabs = {
  new: (url?: string): Promise<string> => ipcRenderer.invoke("tabs:new", url),
  close: (id: string): Promise<void> => ipcRenderer.invoke("tabs:close", id),
  switch: (id: string): Promise<void> => ipcRenderer.invoke("tabs:switch", id),
  list: (): Promise<TabsSnapshot> => ipcRenderer.invoke("tabs:list"),
  // Drag-reorder in the tab strip — moves dragId to sit right before
  // dropId's current position.
  reorder: (dragId: string, dropId: string): Promise<void> => ipcRenderer.invoke("tabs:reorder", dragId, dropId),
  navigate: (id: string, url: string): Promise<void> => ipcRenderer.invoke("tabs:navigate", id, url),
  goBack: (id: string): Promise<void> => ipcRenderer.invoke("tabs:goBack", id),
  goForward: (id: string): Promise<void> => ipcRenderer.invoke("tabs:goForward", id),
  reload: (id: string): Promise<void> => ipcRenderer.invoke("tabs:reload", id),
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
};const tools = {
  execute: (name: string, args: Record<string, unknown>): Promise<ToolResult> =>
    ipcRenderer.invoke("tools:execute", name, args),
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

contextBridge.exposeInMainWorld("browserAPI", { tabs, bookmarks, headerFavorites, auth, profiles, passwords, tools, downloads, system, importer, window: windowControls });
contextBridge.exposeInMainWorld("platformInfo", { platform: process.platform });

export type BrowserAPI = {
  tabs: typeof tabs;
  bookmarks: typeof bookmarks;
  headerFavorites: typeof headerFavorites;
  auth: typeof auth;
  profiles: typeof profiles;
  passwords: typeof passwords;
  tools: typeof tools;
  window: typeof windowControls;
};

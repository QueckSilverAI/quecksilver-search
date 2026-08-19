import { useCallback, useEffect, useState } from "react";

export const HOME_URL = "quecksilver://newtab";
export const SETTINGS_URL = "quecksilver://settings";

export type TabState = {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isHome: boolean;
  isSettings: boolean;
  groupId: string | null;
  nightMode: boolean;
  isAudible: boolean;
  isMuted: boolean;
};
export type TabGroup = { id: string; name: string; color: string; collapsed: boolean };

export type TabsSnapshot = { activeId: string | null; secondaryId: string | null; tabs: TabState[]; groups: TabGroup[] };
export type ContentBounds = { x: number; y: number; width: number; height: number };
export type Bookmark = { label: string; url: string } | null;
export type HeaderFavorite = {
  id: string;
  label: string;
  url: string;
  iconOnly?: boolean;
  updatedAt?: number;
  deletedAt?: number;
  // Folders: a flat list with parent references, not a tree — keeps the
  // existing sync/storage format (soft-delete via deletedAt, per-item
  // updatedAt) completely unchanged; nesting is just one extra field. A
  // folder entry has isFolder true and url "" (unused — folders aren't
  // navigable themselves). A favorite (or, in principle, a folder,
  // though the UI never nests folders inside folders) that's INSIDE a
  // folder has parentId set to that folder's id; top-level items have no
  // parentId at all.
  isFolder?: boolean;
  parentId?: string | null;
};
export type AuthSession = { accessToken: string; userId: string | null; email: string | null; obtainedAt: number } | null;
export type ToolResult = { ok: boolean; text: string };
export type ProfileKind = "quecksilver" | "simple";
export type Profile = { id: string; kind: ProfileKind; name: string; email: string | null; createdAt: number };
export type ActiveIdentity = { activeProfileId: string | null; guestMode: boolean; windowMode?: "normal" | "incognito" | "tor" };
export type PasswordEntry = { id: string; url: string; username: string; password: string; createdAt: number; updatedAt: number };
export type PasswordImportResult = { imported: number; skipped: number; error: string | null };
export type SessionRecovery = { available: boolean; tabCount: number; crashed: boolean };
export type FoundInPageResult = { tabId: string; matches: number; activeMatchOrdinal: number };
export type DownloadItem = {
  id: string;
  filename: string;
  path: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
};

type BrowserAPI = {
  tabs: {
    new: (url?: string) => Promise<string>;
    close: (id: string) => Promise<void>;
    switch: (id: string) => Promise<void>;
    list: () => Promise<TabsSnapshot>;
    reorder: (newOrder: string[]) => Promise<void>;
    navigate: (id: string, url: string) => Promise<void>;
    goBack: (id: string) => Promise<void>;
    goForward: (id: string) => Promise<void>;
    reload: (id: string) => Promise<void>;
    setBounds: (bounds: ContentBounds) => Promise<void>;
    setVisible: (visible: boolean) => Promise<void>;
    setDefaultZoom: (factor: number) => Promise<void>;
    enterSplit: (id: string) => Promise<void>;
    exitSplit: () => Promise<void>;
    setSplitRatio: (ratio: number) => Promise<void>;
    onChanged: (cb: (state: TabsSnapshot) => void) => () => void;
    createGroup: (name: string, color: string) => Promise<string | null>;
    setGroup: (tabId: string, groupId: string | null) => Promise<void>;
    renameGroup: (groupId: string, name: string) => Promise<void>;
    setGroupColor: (groupId: string, color: string) => Promise<void>;
    setGroupCollapsed: (groupId: string, collapsed: boolean) => Promise<void>;
    removeGroup: (groupId: string) => Promise<void>;
    findInPage: (query: string, forward?: boolean, findNext?: boolean) => Promise<void>;
    stopFindInPage: () => Promise<void>;
    onFoundInPage: (cb: (result: FoundInPageResult) => void) => () => void;
    togglePiP: () => Promise<"entered" | "exited" | "no-video">;
    toggleNightMode: () => Promise<boolean>;
    toggleNightModeFor: (id: string) => Promise<boolean>;
    isNightMode: (id: string) => Promise<boolean>;
    toggleMute: (id: string) => Promise<void>;
    focusChrome: () => Promise<void>;
    copySelectionFor: (tabId: string) => Promise<void>;
  };
  bookmarks: {
    list: () => Promise<Bookmark[]>;
    save: (value: Bookmark[]) => Promise<void>;
    onChanged: (cb: (value: Bookmark[]) => void) => () => void;
  };
  headerFavorites: {
    list: () => Promise<HeaderFavorite[]>;
    save: (value: HeaderFavorite[]) => Promise<void>;
    onChanged: (cb: (value: HeaderFavorite[]) => void) => () => void;
  };
  auth: {
    getSession: () => Promise<AuthSession>;
    login: (mode?: "new-profile" | "reauth") => Promise<AuthSession>;
    cancelLogin: () => Promise<void>;
    logout: () => Promise<void>;
    onChanged: (cb: (session: AuthSession) => void) => () => void;
  };
  profiles: {
    list: () => Promise<Profile[]>;
    getActive: () => Promise<ActiveIdentity>;
    createSimple: (name: string) => Promise<Profile>;
    rename: (id: string, name: string) => Promise<void>;
    setActive: (id: string) => Promise<void>;
    enterGuest: () => Promise<void>;
    openInNewWindow: (identity: ActiveIdentity) => Promise<void>;
    remove: (id: string) => Promise<void>;
    syncNow: () => Promise<boolean>;
    onChanged: (cb: (value: { profiles: Profile[]; active: ActiveIdentity }) => void) => () => void;
  };
  passwords: {
    list: () => Promise<PasswordEntry[]>;
    add: (url: string, username: string, password: string) => Promise<PasswordEntry>;
    update: (id: string, url: string, username: string, password?: string) => Promise<PasswordEntry | null>;
    remove: (id: string) => Promise<void>;
    import: (browser: "chrome" | "edge", profileId: string) => Promise<PasswordImportResult>;
    onChanged: (cb: (value: PasswordEntry[]) => void) => () => void;
    onAutoSaved: (cb: (value: { url: string; username: string }) => void) => () => void;
  };
  tools: {
    execute: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  };
  downloads: {
    list: () => Promise<DownloadItem[]>;
    remove: (id: string) => Promise<void>;
    open: (filePath: string) => Promise<void>;
    showInFolder: (filePath: string) => Promise<void>;
    getFolder: () => Promise<string>;
    openFolder: () => Promise<void>;
    pickFolder: () => Promise<string>;
    onChanged: (cb: (items: DownloadItem[]) => void) => () => void;
  };
  system: {
    isDefaultBrowser: () => Promise<boolean>;
    setDefaultBrowser: () => Promise<void>;
  };
  importer: {
    listProfiles: (browser: "chrome" | "edge") => Promise<{ id: string; name: string }[]>;
    bookmarks: (browser: "chrome" | "edge", profileId: string) => Promise<HeaderFavorite[] | null>;
  };
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    setFullScreen: (value: boolean) => Promise<void>;
    isFullscreen: () => Promise<boolean>;
    onStateChanged: (cb: (state: { isMaximized: boolean }) => void) => () => void;
    onShortcutF11: (cb: () => void) => () => void;
    onShortcutEscape: (cb: () => void) => () => void;
    onShortcutFocusUrlBar: (cb: () => void) => () => void;
    onShortcutAddFavorite: (cb: () => void) => () => void;
    onShortcutFindInPage: (cb: () => void) => () => void;
    onShortcutTabSearch: (cb: () => void) => () => void;
    onShortcutOpenPasswordSettings: (cb: () => void) => () => void;
    onFullscreenChanged: (cb: (isFullscreen: boolean) => void) => () => void;
  };
  session: {
    getRecovery: () => Promise<SessionRecovery>;
    restoreAccepted: () => Promise<void>;
    restoreDismissed: () => Promise<void>;
    getRestoreOnStart: () => Promise<boolean>;
    setRestoreOnStart: (value: boolean) => Promise<void>;
  };
  frequentSites: {
    list: (prefix: string) => Promise<{ domain: string; visitCount: number; lastVisit: number }[]>;
  };
  images: {
    copy: (url: string) => Promise<void>;
    save: (url: string) => Promise<void>;
    saveDirect: (url: string) => Promise<void>;
    copyLink: (url: string) => Promise<void>;
  };
  links: {
    copy: (url: string) => Promise<void>;
    openInNewTab: (url: string) => Promise<void>;
    openInNewWindow: (url: string) => Promise<void>;
    openInIncognitoWindow: (url: string) => Promise<void>;
    openHere: (tabId: string, url: string) => Promise<void>;
    saveAs: (url: string) => Promise<void>;
  };
  permissions: {
    list: () => Promise<{ domain: string; camera: "allow" | "block"; microphone: "allow" | "block"; notifications: "allow" | "block"; autoDownloads: "allow" | "block"; updatedAt: number }[]>;
    set: (domain: string, kind: "camera" | "microphone" | "notifications" | "autoDownloads", state: "allow" | "block") => Promise<void>;
    remove: (domain: string) => Promise<void>;
  };
  extensions: {
    list: () => Promise<{ id: string; name: string; path: string; enabled: boolean }[]>;
    addFromFolder: () => Promise<{ id: string; name: string; path: string; enabled: boolean } | { error: string } | null>;
    remove: (id: string) => Promise<void>;
    setEnabled: (id: string, enabled: boolean) => Promise<void>;
  };
  appUpdate: {
    install: () => Promise<void>;
    onReady: (cb: () => void) => () => void;
  };
  privacy: {
    get: () => Promise<{
      removeTrackingParams: boolean;
      httpsOnly: boolean;
      dohProvider: "off" | "cloudflare" | "quad9";
      panicShortcut: string;
      phishingProtection: boolean;
      torBinaryPath: string;
      torSecurityLevel: "standard" | "safer" | "safest";
    }>;
    set: (patch: Partial<{
      removeTrackingParams: boolean;
      httpsOnly: boolean;
      dohProvider: "off" | "cloudflare" | "quad9";
      panicShortcut: string;
      phishingProtection: boolean;
      torBinaryPath: string;
      torSecurityLevel: "standard" | "safer" | "safest";
    }>) => Promise<{
      removeTrackingParams: boolean;
      httpsOnly: boolean;
      dohProvider: "off" | "cloudflare" | "quad9";
      panicShortcut: string;
      phishingProtection: boolean;
      torBinaryPath: string;
      torSecurityLevel: "standard" | "safer" | "safest";
    }>;
  };
  tor: {
    getStatus: () => Promise<
      | { state: "stopped" }
      | { state: "starting"; bootstrapPercent: number; message: string }
      | { state: "ready"; socksPort: number }
      | { state: "error"; message: string }
    >;
    newIdentity: () => Promise<void>;
    onStatusChanged: (
      cb: (
        status:
          | { state: "stopped" }
          | { state: "starting"; bootstrapPercent: number; message: string }
          | { state: "ready"; socksPort: number }
          | { state: "error"; message: string },
      ) => void,
    ) => () => void;
  };
  // See electron/overlay-window.ts (Phase 1-3 of the native-overlay plan) —
  // opens/closes the separate native overlay window; anchor is a
  // getBoundingClientRect()-shaped rect of whatever the overlay should
  // hang off (matches ProfilePopup.tsx's existing AnchorRect).
  overlay: {
    open: (
      kind: "profile" | "contextmenu" | "bookmark" | "groupDialog" | "tabSearch" | "downloads" | "favoriteContextMenu" | "favoriteEditDialog" | "favoriteFolder" | "newFavoriteFolderDialog",
      payload: unknown,
      anchor: { top: number; left: number; right: number; bottom: number; placement?: "belowRight" | "atPoint" | "cover" },
    ) => Promise<void>;
    close: () => Promise<void>;
    update: (kind: "profile" | "contextmenu" | "bookmark" | "groupDialog" | "tabSearch" | "downloads" | "favoriteContextMenu" | "favoriteEditDialog" | "favoriteFolder" | "newFavoriteFolderDialog", payload: unknown) => Promise<void>;
    onAction: (cb: (action: { kind: "profile" | "contextmenu" | "bookmark" | "groupDialog" | "tabSearch" | "downloads" | "favoriteContextMenu" | "favoriteEditDialog" | "favoriteFolder" | "newFavoriteFolderDialog"; action: unknown }) => void) => () => void;
  };
};

declare global {
  interface Window {
    browserAPI?: BrowserAPI;
    platformInfo?: { platform: string };
  }
}

// Outside Electron — e.g. the Lovable web preview — there is no window.browserAPI.
// We show a single fake "home" tab so the chrome UI still renders completely.
const FALLBACK_SNAPSHOT: TabsSnapshot = {
  activeId: "preview",
  secondaryId: null,
  groups: [],
  tabs: [
    {
      id: "preview",
      url: HOME_URL,
      title: "New Tab",
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isHome: true,
      isSettings: false,
      groupId: null,
      nightMode: false,
      isAudible: false,
      isMuted: false,
    },
  ],
};

export function useBrowserApi() {
  const api = typeof window !== "undefined" ? window.browserAPI : undefined;
  const isElectron = Boolean(api);
  const [snapshot, setSnapshot] = useState<TabsSnapshot>(
    isElectron ? { activeId: null, secondaryId: null, tabs: [], groups: [] } : FALLBACK_SNAPSHOT,
  );

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api.tabs.list().then((state) => {
      if (!cancelled) setSnapshot(state);
    });
    const unsubscribe = api.tabs.onChanged(setSnapshot);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  const newTab = useCallback((url?: string) => api?.tabs.new(url), [api]);
  const closeTab = useCallback((id: string) => api?.tabs.close(id), [api]);
  const switchTab = useCallback((id: string) => api?.tabs.switch(id), [api]);
  const reorderTabs = useCallback((newOrder: string[]) => api?.tabs.reorder(newOrder), [api]);
  const navigate = useCallback((id: string, url: string) => api?.tabs.navigate(id, url), [api]);
  const goBack = useCallback((id: string) => api?.tabs.goBack(id), [api]);
  const goForward = useCallback((id: string) => api?.tabs.goForward(id), [api]);
  const reload = useCallback((id: string) => api?.tabs.reload(id), [api]);
  const setBounds = useCallback((bounds: ContentBounds) => api?.tabs.setBounds(bounds), [api]);
  const setVisible = useCallback((visible: boolean) => api?.tabs.setVisible(visible), [api]);
  const setDefaultZoom = useCallback((factor: number) => api?.tabs.setDefaultZoom(factor), [api]);
  const enterSplit = useCallback((id: string) => api?.tabs.enterSplit(id), [api]);
  const exitSplit = useCallback(() => api?.tabs.exitSplit(), [api]);
  const setSplitRatio = useCallback((ratio: number) => api?.tabs.setSplitRatio(ratio), [api]);
  const createGroup = useCallback((name: string, color: string) => api?.tabs.createGroup(name, color), [api]);
  const setTabGroup = useCallback((tabId: string, groupId: string | null) => api?.tabs.setGroup(tabId, groupId), [api]);
  const renameGroup = useCallback((groupId: string, name: string) => api?.tabs.renameGroup(groupId, name), [api]);
  const setGroupColor = useCallback((groupId: string, color: string) => api?.tabs.setGroupColor(groupId, color), [api]);
  const setGroupCollapsed = useCallback((groupId: string, collapsed: boolean) => api?.tabs.setGroupCollapsed(groupId, collapsed), [api]);
  const removeGroup = useCallback((groupId: string) => api?.tabs.removeGroup(groupId), [api]);
  const togglePiP = useCallback(() => api?.tabs.togglePiP(), [api]);
  const toggleNightMode = useCallback(() => api?.tabs.toggleNightMode(), [api]);

  const activeTab = snapshot.tabs.find((t) => t.id === snapshot.activeId) ?? null;
  const secondaryTab = snapshot.tabs.find((t) => t.id === snapshot.secondaryId) ?? null;

  return {
    tabs: snapshot.tabs,
    groups: snapshot.groups,
    activeId: snapshot.activeId,
    activeTab,
    secondaryId: snapshot.secondaryId,
    secondaryTab,
    isElectron,
    newTab,
    closeTab,
    switchTab,
    reorderTabs,
    navigate,
    goBack,
    goForward,
    reload,
    setBounds,
    setVisible,
    setDefaultZoom,
    enterSplit,
    exitSplit,
    setSplitRatio,
    createGroup,
    setTabGroup,
    renameGroup,
    setGroupColor,
    setGroupCollapsed,
    removeGroup,
    togglePiP,
    toggleNightMode,
  };
}

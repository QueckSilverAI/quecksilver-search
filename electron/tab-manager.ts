import { app, BrowserWindow, dialog, WebContentsView } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import {
  HOME_URL,
  SETTINGS_URL,
  type ContentBounds,
  type SessionSnapshot,
  type TabGroup,
  type TabState,
  type TabsSnapshot,
} from "./types";
import { stepZoom } from "./zoom";
import { stripTrackingParams } from "./tracking-params";
import {
  trackingParamsEnabled,
  httpsOnlyEnabled,
  phishingProtectionEnabled,
} from "./privacy-settings-store";
import { checkUrlSafety } from "./phishing-guard";
import { getOriginalHttpUrl, allowHttpOnce } from "./https-upgrade-tracker";
import { popupBlockEnabled } from "./control-center-store";

// Runs at document-start in every browsed tab, injecting a small clean
// scrollbar before first paint (see tab-preload.ts) — replaces an earlier
// insertCSS()-on-dom-ready approach, which was late enough to flash
// Chromium's default scrollbar for a frame or two first.
const TAB_PRELOAD_PATH = path.join(__dirname, "tab-preload.cjs");

// Electron's default UA advertises "...Chrome/X.Y Electron/Z.W QueckSilver
// Search/V..." — real sites' login flows (Google's most visibly, but this
// is also the likely cause of the plain https://github.com/ load failing
// outright) treat that "Electron/..." token as an untrusted/automated
// browser and refuse to serve the normal page at all, which is what shows
// up here as blank white pages or a did-fail-load "page isn't available".
// Presenting as a stock, current desktop Chrome build (same Chromium
// version Electron actually ships, so nothing about the real engine is
// misrepresented) is the standard fix every Electron-based browser needs.
const CHROME_VERSION = process.versions.chrome ?? "128.0.0.0";
const PLATFORM_UA_TOKEN =
  process.platform === "win32"
    ? "Windows NT 10.0; Win64; x64"
    : process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : "X11; Linux x86_64";
const TAB_USER_AGENT = `Mozilla/5.0 (${PLATFORM_UA_TOKEN}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

// Hosts whose sign-in flow is built around a real popup window (Google
// Identity Services and Microsoft's MSAL both explicitly require one — see
// setWindowOpenHandler below). Matched by hostname suffix, not substring,
// so this can't be spoofed by e.g. "accounts.google.com.evil.example".
const AUTH_POPUP_HOSTS = [
  "accounts.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "login.live.com",
  "www.facebook.com",
  "github.com/login",
];

function isAuthPopupUrl(url: string): boolean {
  try {
    const { hostname, href } = new URL(url);
    return AUTH_POPUP_HOSTS.some((entry) => {
      const [host, pathPrefix] = entry.split("/", 2);
      if (hostname !== host && !hostname.endsWith(`.${host}`)) return false;
      return !pathPrefix || href.includes(`/${pathPrefix}`);
    });
  } catch {
    return false;
  }
}

// Owns one WebContentsView per browser tab and layers the active one on top
// of the chrome UI (the React app rendered by the main window itself).
// Only the active tab's view is ever attached — closed/background tabs are
// fully detached, not just hidden, to keep memory/CPU down.
export class TabManager {
  private win: BrowserWindow;
  private views = new Map<string, WebContentsView>();
  private order: string[] = [];
  private activeId: string | null = null;
  // The tab shown alongside activeId on the right half, or null when split
  // view is off. Both views stay fully attached/rendering simultaneously
  // while split is active — unlike the normal single-tab case where only
  // one view is ever attached at a time.
  private secondaryId: string | null = null;
  // 0..1 — how much of the split width the left side gets. Draggable from
  // the renderer via setSplitRatio, same divider-drag pattern as the
  // resizable panels in QueckSilver AI's code workspace.
  private splitRatio = 0.5;
  private bounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private contentVisible = true;
  // Explicitly tracked rather than inferred from wc.getURL() — after
  // navigate(id, HOME_URL) loads "about:blank" to clear the page, getURL()
  // would report "about:blank" (not empty), so inference alone can't tell
  // "freshly created, nothing loaded yet" apart from "user went home".
  private homeTabs = new Set<string>();
  private settingsTabs = new Set<string>();
  // Tabs where the person has done a Ctrl+scroll/pinch themselves — the
  // Settings "Page zoom" default is deliberately NOT reapplied to these
  // (see setDefaultZoom), same as how Chrome's own zoom default never
  // overwrites a page you've manually zoomed. Cleared on the tab's next
  // real navigation, same as Chrome resetting per-site zoom on a new site.
  private manualZoomTabs = new Set<string>();
  // Per-tab night mode — CSS key returned by webContents.insertCSS(), kept
  // so toggling off can removeInsertedCSS() the exact rule instead of
  // guessing. Absence from this map means night mode is off for that tab.
  private nightModeTabs = new Map<string, string>();
  private mutedTabs = new Set<string>();
  private audibleTabs = new Set<string>();
  // id -> creation timestamp (ms since epoch) — see TabState.openedAt.
  private openedAt = new Map<string, number>();
  // id -> url to skip the Safe Browsing check for, once. Set right before
  // showing the warning page for that url, from EITHER navigate() (typed
  // URL/bookmark/favorite) or the will-navigate handler (in-page link
  // click) below — shared across both so "Continue anyway" works no
  // matter which path originally triggered the warning. Without this,
  // clicking through would just get checked again, found unsafe again,
  // and show the same warning page again.
  private bypassPhishingCheckFor = new Map<string, string>();
  // The current "Page zoom" setting value (Settings → Zoom) — applied to
  // every newly created tab, and to any existing tab that hasn't been
  // manually zoomed. Kept here (not just pushed out per-tab) so a freshly
  // created tab picks it up immediately instead of starting at 100% for a
  // frame.
  private defaultZoomFactor = 1;
  private viewCreatedListeners: Array<(webContents: Electron.WebContents) => void> = [];
  // --- Tab groups ---------------------------------------------------------
  private groups = new Map<string, TabGroup>();
  private tabGroupOf = new Map<string, string>();
  // Ctrl+Shift+T stack — most-recently-closed last, capped at 15. Deliberately
  // in-memory only (matches the app's "no history" design — this is undo for
  // the current session, not a persisted record of anything).
  private closedTabs: { url: string; groupId: string | null }[] = [];
  // Called after every emitChange — lets main.ts keep a debounced session
  // snapshot on disk for crash-recovery/session-restore without TabManager
  // needing to know anything about how that's persisted.
  private onStateChange: (() => void) | null = null;
  // Fired on every real top-level navigation of a real (non-home,
  // non-settings) tab — main.ts wires this to frequent-sites-store.ts's
  // recordVisit(). Kept as a callback, same pattern as onStateChange
  // above, so TabManager itself doesn't need to know windowId or anything
  // about how/where visits get persisted.
  private onNavigate: ((url: string) => void) | null = null;
  // Fired on every right-click that lands on an image, a link, or actual
  // selected text — main.ts wires this to open the native overlay window's
  // right-click menu (showContextMenu → OverlayWindowManager.open). Kept
  // as a callback (not built here) because the actual save/copy/open
  // actions it needs to call already live in main.ts, right next to the
  // equivalent IPC handlers other UI uses for the same actions — no
  // reason to duplicate that logic here.
  private onContextMenuRequest:
    | ((
        tabId: string,
        webContents: Electron.WebContents,
        params: Electron.ContextMenuParams,
        bounds: ContentBounds,
      ) => void)
    | null = null;
  private contentSession: Electron.Session | null = null;

  constructor(
    win: BrowserWindow,
    onStateChange?: () => void,
    onNavigate?: (url: string) => void,
    onContextMenuRequest?: (
      tabId: string,
      webContents: Electron.WebContents,
      params: Electron.ContextMenuParams,
      bounds: ContentBounds,
    ) => void,
    // Every tab's WebContentsView uses this session instead of Electron's
    // implicit default one — undefined for a normal window (default
    // session, same as before this param existed). Incognito/Tor windows
    // pass their own dedicated, non-persistent partition (see
    // createIncognitoWindow/createTorWindow in main.ts) so their cookies,
    // cache, and storage never touch the default session at all, and
    // simply cease to exist once that partition's last reference (this
    // window) is gone.
    contentSession?: Electron.Session,
  ) {
    this.win = win;
    this.onStateChange = onStateChange ?? null;
    this.onNavigate = onNavigate ?? null;
    this.onContextMenuRequest = onContextMenuRequest ?? null;
    this.contentSession = contentSession ?? null;
    this.createTab(HOME_URL);
  }

  // --- public API (called from IPC handlers in main.ts) ---------------

  listTabs(): TabsSnapshot {
    return {
      activeId: this.activeId,
      secondaryId: this.secondaryId,
      tabs: this.order.map((id) => this.stateFor(id)),
      groups: [...this.groups.values()],
    };
  }

  // --- Tab groups ----------------------------------------------------------
  // Purely metadata + collapse state — TabManager doesn't reorder tabs to
  // keep a group's members contiguous (the renderer's drag-reorder already
  // owns tab order); TabStrip.tsx clusters same-group tabs visually where
  // they happen to already be adjacent, and a collapsed group just hides
  // its tabs' rows without touching this.order or detaching their views.
  createGroup(name: string, color: string): string {
    const id = randomUUID();
    this.groups.set(id, { id, name, color, collapsed: false });
    this.emitChange();
    return id;
  }

  setTabGroup(tabId: string, groupId: string | null) {
    if (!this.views.has(tabId)) return;
    if (groupId && !this.groups.has(groupId)) return;
    if (groupId) this.tabGroupOf.set(tabId, groupId);
    else this.tabGroupOf.delete(tabId);
    this.pruneEmptyGroups();
    this.emitChange();
  }

  renameGroup(groupId: string, name: string) {
    const group = this.groups.get(groupId);
    if (!group) return;
    this.groups.set(groupId, { ...group, name });
    this.emitChange();
  }

  setGroupColor(groupId: string, color: string) {
    const group = this.groups.get(groupId);
    if (!group) return;
    this.groups.set(groupId, { ...group, color });
    this.emitChange();
  }

  setGroupCollapsed(groupId: string, collapsed: boolean) {
    const group = this.groups.get(groupId);
    if (!group) return;
    this.groups.set(groupId, { ...group, collapsed });
    // The active tab stays active, even if it's inside the group being
    // collapsed and now invisible — nothing about which tab is "the"
    // active one changes here. This used to switch away to some other
    // tab outside the group, on the theory that an active-but-hidden tab
    // was a bad state, but that's exactly wrong: the collapsed group's
    // own chip stands in for it (see TabStrip.tsx's groupIsActive — it
    // shows white/selected precisely when the active tab is one of its
    // now-hidden members), so switching away was overriding a choice the
    // person didn't make.
    this.emitChange();
  }

  removeGroup(groupId: string) {
    for (const [tabId, g] of this.tabGroupOf) if (g === groupId) this.tabGroupOf.delete(tabId);
    this.groups.delete(groupId);
    this.emitChange();
  }

  private pruneEmptyGroups() {
    const used = new Set(this.tabGroupOf.values());
    for (const id of this.groups.keys()) if (!used.has(id)) this.groups.delete(id);
  }

  // --- Find-in-page ----------------------------------------------------------
  findInPage(id: string, query: string, forward = true, findNext = false) {
    const wc = this.views.get(id)?.webContents;
    if (!wc) return;
    if (!query) {
      wc.stopFindInPage("clearSelection");
      return;
    }
    wc.findInPage(query, { forward, findNext });
  }

  stopFindInPage(id: string) {
    this.views.get(id)?.webContents.stopFindInPage("clearSelection");
  }

  // --- Picture-in-Picture ----------------------------------------------------
  // No dedicated Electron API for this — it's driven entirely by the page's
  // own <video> element and the standard Document PiP web API, same as any
  // real browser's PiP button. userGesture: true is required: without it
  // requestPictureInPicture() rejects as "not triggered by user activation"
  // since crossing the IPC boundary from the renderer's button click into
  // this executeJavaScript call doesn't carry the original click's real
  // activation with it — this is Electron's documented way to simulate one
  // for exactly this kind of case.
  async togglePictureInPicture(id: string): Promise<"entered" | "exited" | "no-video"> {
    const wc = this.views.get(id)?.webContents;
    if (!wc) return "no-video";
    const script = `(() => {
      if (document.pictureInPictureElement) { document.exitPictureInPicture(); return "exited"; }
      const videos = [...document.querySelectorAll("video")]
        .filter((v) => v.readyState > 0)
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
      const target = videos[0];
      if (!target) return "no-video";
      target.requestPictureInPicture();
      return "entered";
    })()`;
    try {
      return await wc.executeJavaScript(script, true);
    } catch {
      return "no-video";
    }
  }

  // --- Night mode (per tab, not global) ---------------------------------
  // Filter-based, not a real dark theme — a genuine "read every site's own
  // CSS variables and re-theme them" approach isn't something a browser
  // can do reliably across arbitrary sites; the same invert+hue-rotate
  // trick every "force dark mode" extension uses is the pragmatic version.
  // Images/video get a matching counter-invert so photos don't look like
  // photo negatives.
  async toggleNightMode(id: string): Promise<boolean> {
    const wc = this.views.get(id)?.webContents;
    if (!wc) return false;
    const existingKey = this.nightModeTabs.get(id);
    if (existingKey) {
      await wc.removeInsertedCSS(existingKey).catch(() => {});
      this.nightModeTabs.delete(id);
      this.emitChange();
      return false;
    }
    const key = await wc.insertCSS(`
      html { filter: invert(1) hue-rotate(180deg) !important; background: #fff !important; }
      img, video, picture, canvas, svg, iframe { filter: invert(1) hue-rotate(180deg) !important; }
    `);
    this.nightModeTabs.set(id, key);
    this.emitChange();
    return true;
  }

  isNightMode(id: string): boolean {
    return this.nightModeTabs.has(id);
  }

  // --- Control center: global dark mode ----------------------------------
  // Same invert+hue-rotate CSS trick as toggleNightMode above, just applied
  // to every current tab at once and remembered so every tab created
  // afterwards gets it too — this is the Control center's "Darkmode
  // erzwingen" switch, deliberately independent of the per-tab night-mode
  // toggle (a person could still turn a single tab's night mode off/on on
  // top of the global one; the two don't share bookkeeping).
  private globalDarkModeEnabled = false;
  private readonly globalDarkModeKeys = new Map<string, string>();

  private readonly GLOBAL_DARK_CSS = `
    html { filter: invert(1) hue-rotate(180deg) !important; background: #fff !important; }
    img, video, picture, canvas, svg, iframe { filter: invert(1) hue-rotate(180deg) !important; }
  `;

  async setGlobalDarkMode(enabled: boolean) {
    this.globalDarkModeEnabled = enabled;
    for (const [id, view] of this.views) {
      const wc = view.webContents;
      const existingKey = this.globalDarkModeKeys.get(id);
      if (existingKey) {
        await wc.removeInsertedCSS(existingKey).catch(() => {});
        this.globalDarkModeKeys.delete(id);
      }
      if (enabled) {
        const key = await wc.insertCSS(this.GLOBAL_DARK_CSS).catch(() => null);
        if (key) this.globalDarkModeKeys.set(id, key);
      }
    }
  }

  // Called from createTab/loadURL-style paths for a freshly attached view
  // so a tab opened AFTER the global toggle was flipped on still gets it.
  private applyGlobalDarkModeTo(id: string, wc: Electron.WebContents) {
    if (!this.globalDarkModeEnabled) return;
    wc.insertCSS(this.GLOBAL_DARK_CSS)
      .then((key) => this.globalDarkModeKeys.set(id, key))
      .catch(() => {});
  }

  // --- Control center: master mute ---------------------------------------
  // Mutes/unmutes every open tab in one shot, and remembers the setting so
  // every tab created afterwards starts muted too — separate bookkeeping
  // from the individual per-tab mute (mutedTabs/toggleMute above), same
  // reasoning as global dark mode vs per-tab night mode.
  private masterMuteEnabled = false;

  setMasterMute(enabled: boolean) {
    this.masterMuteEnabled = enabled;
    for (const view of this.views.values()) {
      view.webContents.setAudioMuted(enabled);
    }
    this.emitChange();
  }

  private applyMasterMuteTo(wc: Electron.WebContents) {
    if (this.masterMuteEnabled) wc.setAudioMuted(true);
  }

  // --- Control center: per-tab JavaScript execution toggle ---------------
  // Electron's webPreferences.javascript can only be set at WebContentsView
  // creation time, not flipped live — the Chrome DevTools Protocol's
  // Emulation domain is the one real way to disable/re-enable script
  // execution on an ALREADY-RUNNING page without recreating the view (and
  // therefore without losing the tab's history/scroll position).
  private javascriptGloballyDisabled = false;

  async setJavaScriptGloballyDisabled(disabled: boolean) {
    this.javascriptGloballyDisabled = disabled;
    for (const view of this.views.values()) {
      await this.applyJsToggle(view.webContents, disabled);
    }
  }

  private async applyJsToggle(wc: Electron.WebContents, disabled: boolean) {
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
      await wc.debugger.sendCommand("Emulation.setScriptExecutionDisabled", { value: disabled });
    } catch {
      /* best-effort — some internal pages (chrome UI itself) can't be
         attached to, that's fine, nothing to disable there anyway */
    }
  }

  // --- Control center: network-condition simulation (per active tab) -----
  private readonly THROTTLE_PRESETS: Record<
    string,
    {
      offline: boolean;
      latency: number;
      downloadThroughput: number;
      uploadThroughput: number;
    } | null
  > = {
    off: null,
    slow3g: {
      offline: false,
      latency: 400,
      downloadThroughput: (500 * 1024) / 8,
      uploadThroughput: (500 * 1024) / 8,
    },
    fast3g: {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    },
    offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  };

  async setNetworkThrottle(id: string, preset: "off" | "slow3g" | "fast3g" | "offline") {
    const wc = this.views.get(id)?.webContents;
    if (!wc) return;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
      await wc.debugger.sendCommand("Network.enable");
      const conditions = this.THROTTLE_PRESETS[preset];
      await wc.debugger.sendCommand(
        "Network.emulateNetworkConditions",
        conditions ?? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
      );
    } catch {
      /* best-effort, see applyJsToggle */
    }
  }

  // --- Control center: console error counter ------------------------------
  private consoleErrorCounts = new Map<string, number>();

  private trackConsoleErrors(id: string, wc: Electron.WebContents) {
    wc.on("console-message", (event) => {
      // level 2 === "error" in Electron's console-message event
      if (event.level === 2) {
        this.consoleErrorCounts.set(id, (this.consoleErrorCounts.get(id) ?? 0) + 1);
        this.emitChange();
      }
    });
    wc.on("did-navigate", () => this.consoleErrorCounts.set(id, 0));
  }

  getConsoleErrorCount(id: string): number {
    return this.consoleErrorCounts.get(id) ?? 0;
  }

  getTotalConsoleErrorCount(): number {
    let total = 0;
    for (const n of this.consoleErrorCounts.values()) total += n;
    return total;
  }

  // --- Control center: screenshot + print/save-as-PDF ---------------------
  async captureScreenshot(id: string): Promise<string | null> {
    const wc = this.views.get(id)?.webContents;
    if (!wc) return null;
    const image = await wc.capturePage();
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Screenshot speichern",
      defaultPath: path.join(app.getPath("pictures"), `screenshot-${Date.now()}.png`),
      filters: [{ name: "PNG-Bild", extensions: ["png"] }],
    });
    if (canceled || !filePath) return null;
    await fs.writeFile(filePath, image.toPNG());
    return filePath;
  }

  async saveAsPdf(id: string): Promise<string | null> {
    const wc = this.views.get(id)?.webContents;
    if (!wc) return null;
    const data = await wc.printToPDF({});
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Als PDF speichern",
      defaultPath: path.join(app.getPath("documents"), `seite-${Date.now()}.pdf`),
      filters: [{ name: "PDF-Dokument", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) return null;
    await fs.writeFile(filePath, data);
    return filePath;
  }

  printPage(id: string) {
    this.views.get(id)?.webContents.print({ silent: false });
  }

  async savePageAs(id: string): Promise<string | null> {
    const wc = this.views.get(id)?.webContents;
    if (!wc) return null;
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Seite speichern unter",
      defaultPath: path.join(app.getPath("downloads"), `seite-${Date.now()}.html`),
      filters: [{ name: "Webseite, komplett", extensions: ["html"] }],
    });
    if (canceled || !filePath) return null;
    await wc.savePage(filePath, "HTMLComplete");
    return filePath;
  }

  openDevTools(id: string) {
    this.views.get(id)?.webContents.openDevTools({ mode: "right" });
  }

  clearCache(): Promise<void> {
    return this.win.webContents.session.clearCache();
  }

  // --- Control center: unload (discard) an inactive tab -------------------
  // Real Chrome-style "tab discarding": destroys the tab's WebContentsView
  // (freeing its renderer process/GPU resources) while keeping the tab
  // pill itself around, remembering its URL so switching back to it just
  // reloads fresh instead of the tab disappearing from the strip. Never
  // called on the active (or split-secondary) tab — that would blank
  // whatever the person is currently looking at.
  private readonly unloadedTabUrls = new Map<string, string>();

  unloadTab(id: string): boolean {
    if (id === this.activeId || id === this.secondaryId) return false;
    const view = this.views.get(id);
    if (!view) return false;
    const url = view.webContents.getURL();
    if (url) this.unloadedTabUrls.set(id, url);
    if (this.win.contentView.children.includes(view)) this.win.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(id);
    this.emitChange();
    return true;
  }

  isUnloaded(id: string): boolean {
    return this.unloadedTabUrls.has(id);
  }

  // Reloads a discarded tab's view on demand — callers (switchTo) check
  // isUnloaded() first and call this instead of just re-showing the
  // (no-longer-existing) view.
  reviveUnloadedTab(id: string): string | null {
    const url = this.unloadedTabUrls.get(id);
    if (!url) return null;
    this.unloadedTabUrls.delete(id);
    return url;
  }

  unloadAllBackgroundTabs(): number {
    let count = 0;
    for (const id of [...this.views.keys()]) {
      if (this.unloadTab(id)) count++;
    }
    return count;
  }

  // --- Control center: background-tab throttling --------------------------
  // Electron's own real mechanism for this (not a simulation): a
  // backgrounded renderer with this set gets deprioritized timers/rAF the
  // same way Chrome itself throttles inactive tabs. Applied to every
  // non-active view now, and remembered so new tabs get it too — the
  // active/secondary tab is deliberately left un-throttled (set false)
  // even while the setting is on, since that's the one the person is
  // actually looking at.
  private backgroundTabsThrottled = true;

  setBackgroundTabsThrottled(enabled: boolean) {
    this.backgroundTabsThrottled = enabled;
    for (const [id, view] of this.views) {
      const isForeground = id === this.activeId || id === this.secondaryId;
      view.webContents.setBackgroundThrottling(isForeground ? false : enabled);
    }
  }

  private applyBackgroundThrottleTo(id: string, wc: Electron.WebContents) {
    const isForeground = id === this.activeId || id === this.secondaryId;
    wc.setBackgroundThrottling(isForeground ? false : this.backgroundTabsThrottled);
  }

  // Speaker-icon toggle in TabStrip.tsx — Electron's own setAudioMuted()
  // does the actual muting (silences the tab's audio output directly,
  // independent of whatever volume control the page's own player might
  // have), this just tracks which tabs are muted for the tab-state
  // snapshot and flips it.
  toggleMute(id: string) {
    const wc = this.views.get(id)?.webContents;
    if (!wc) return;
    const next = !this.mutedTabs.has(id);
    wc.setAudioMuted(next);
    if (next) this.mutedTabs.add(id);
    else this.mutedTabs.delete(id);
    this.emitChange();
  }

  // Copies whatever's currently selected in a specific tab — used by the
  // right-click menu's "Copy" item for plain text selections, where the
  // tab that had something selected isn't necessarily "the active tab" by
  // the time the person actually clicks the menu item (they could have
  // switched tabs, though the menu itself doesn't allow that — this is
  // just the more correct/explicit way to target it either way).
  copySelection(id: string) {
    this.views.get(id)?.webContents.copy();
  }

  snapshot(): SessionSnapshot {
    return {
      tabs: this.order.map((id) => ({
        url: this.stateFor(id).url,
        groupId: this.tabGroupOf.get(id) ?? null,
      })),
      groups: [...this.groups.values()],
      activeIndex: this.activeId ? this.order.indexOf(this.activeId) : 0,
    };
  }

  // Replaces whatever's currently open with a saved snapshot — used once,
  // right after a fresh TabManager is constructed (which always starts with
  // a single Start-page tab), so that starting tab is closed once the real
  // ones are in place rather than left as an extra empty tab.
  restoreSnapshot(snapshot: SessionSnapshot) {
    if (snapshot.tabs.length === 0) return;
    const staleId = this.order[0];
    this.groups = new Map(snapshot.groups.map((g) => [g.id, g]));
    const newIds = snapshot.tabs.map((t) => this.createTab(t.url || HOME_URL));
    snapshot.tabs.forEach((t, i) => {
      if (t.groupId) this.tabGroupOf.set(newIds[i]!, t.groupId);
    });
    if (staleId) this.closeTab(staleId);
    const target = newIds[snapshot.activeIndex] ?? newIds[0];
    if (target) this.switchTab(target);
    this.emitChange();
  }

  // Ctrl+Tab / Ctrl+Shift+Tab — cycles through tabs in their current strip
  // order, wrapping around at either end.
  cycleTab(direction: "next" | "prev") {
    if (this.order.length < 2 || !this.activeId) return;
    const currentIndex = this.order.indexOf(this.activeId);
    if (currentIndex === -1) return;
    const delta = direction === "next" ? 1 : -1;
    const nextIndex = (currentIndex + delta + this.order.length) % this.order.length;
    this.switchTab(this.order[nextIndex]!);
  }

  // Ctrl+W — closes the active tab, same as clicking its close button.
  closeActiveTab() {
    if (this.activeId) this.closeTab(this.activeId);
  }

  // Ctrl+R — reloads the active tab, same as clicking the reload button.
  // Ctrl+Shift+R is the same shortcut but bypassing the cache — same
  // convention every other browser uses.
  reloadActiveTab(ignoreCache = false) {
    if (this.activeId) this.reload(this.activeId, ignoreCache);
  }

  // Ctrl+Shift+T — reopens the most recently closed tab, restoring its
  // group membership if it had one. Does nothing (silently) if nothing's
  // been closed this session, same as every other browser's version of
  // this.
  reopenLastClosedTab() {
    const entry = this.closedTabs.pop();
    if (!entry) return;
    const id = this.createTab(entry.url);
    if (entry.groupId && this.groups.has(entry.groupId)) this.tabGroupOf.set(id, entry.groupId);
    this.emitChange();
  }

  // Alt+Left/Right — back/forward for the active tab.
  goBackActive() {
    if (this.activeId) this.goBack(this.activeId);
  }
  goForwardActive() {
    if (this.activeId) this.goForward(this.activeId);
  }

  // Ctrl+1..9 — jumps to the tab at that position in the strip (1-indexed,
  // matching every browser's own convention; 9 always means "last tab",
  // also standard).
  switchToPosition(position: number) {
    if (this.order.length === 0) return;
    const index = position === 9 ? this.order.length - 1 : position - 1;
    const id = this.order[index];
    if (id) this.switchTab(id);
  }

  get activeTabId(): string | null {
    return this.activeId;
  }

  // Lets main.ts attach listeners (like the F11 before-input-event relay)
  // to every tab's WebContents — including ones created after this is
  // called, since browsing opens new tabs constantly.
  onViewCreated(listener: (webContents: Electron.WebContents) => void) {
    this.viewCreatedListeners.push(listener);
    for (const view of this.views.values()) listener(view.webContents);
  }

  createTab(url: string = HOME_URL): string {
    const id = randomUUID();
    this.openedAt.set(id, Date.now());
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: TAB_PRELOAD_PATH,
        // Without this, tab-preload.ts only ever runs in the page's main
        // frame — completely invisible to a login form embedded in an
        // <iframe> (Wix's sign-in widget among them), since that's a
        // fully separate document our script never got injected into at
        // all. Password autofill/autosave now runs per-frame; the
        // scrollbar widget stays main-frame-only (see process.isMainFrame
        // in tab-preload.ts) so it doesn't try to attach itself to every
        // random ad/embed iframe on a page too.
        nodeIntegrationInSubFrames: true,
        // Renders PDFs inline with Chromium's built-in PDF viewer instead
        // of always forcing a download — same plugin Chrome/Edge/every
        // other Chromium browser ship, just off by default in Electron.
        plugins: true,
        ...(this.contentSession ? { session: this.contentSession } : {}),
      },
    });
    view.setBounds(this.bounds);
    // Avoids a grey/transparent flash before the first paint, and keeps
    // about:blank (used internally to "go home") actually white.
    view.setBackgroundColor("#ffffff");
    view.webContents.setUserAgent(TAB_USER_AGENT);
    view.webContents.setZoomFactor(this.defaultZoomFactor);
    // Root cause of "Ctrl+wheel/pinch zoom does nothing" — see main.ts's
    // matching call for the full explanation. Electron disables the
    // page-scale gesture handling by default; without this, zoom-changed
    // can fire but nothing visibly zooms.
    view.webContents.setVisualZoomLevelLimits(1, 3).catch(() => {});
    // Surfaces a crashing tab-preload.cjs in the electron:dev terminal
    // instead of it failing silently — if this ever prints, that's why the
    // scrollbar isn't showing up on a real page.
    view.webContents.on("preload-error", (_event, preloadPath, error) => {
      console.error(`[preload-error][tab ${id}] ${preloadPath}:`, error);
    });
    for (const listener of this.viewCreatedListeners) listener(view.webContents);

    if (url === HOME_URL) {
      this.homeTabs.add(id);
    } else if (url === SETTINGS_URL) {
      this.settingsTabs.add(id);
    } else {
      const initialUrl = this.normalizeUrl(url)!;
      view.webContents
        .loadURL(
          trackingParamsEnabled() ? (stripTrackingParams(initialUrl) ?? initialUrl) : initialUrl,
        )
        .catch(() => {
          /* surfaced to the renderer via did-fail-load below */
        });
    }

    const emit = () => this.emitChange();
    // Without this, Electron's default behavior for target="_blank" links
    // and window.open() calls is to spawn a real, separate OS window — the
    // originally reported bug. BUT a blanket deny-and-redirect-into-the-
    // same-tab breaks a real category of sites: OAuth "sign in with
    // Google/Microsoft/Apple/..." flows are built around an actual popup
    // window that talks back to its opener via postMessage/window.close()
    // — forcing that flow into a full-page navigation in the SAME tab
    // instead leaves it with no opener to message and nothing to close,
    // which is exactly the blank white accounts.google.com/gsi/... page
    // this was causing. Known auth-popup hosts get a real popup window
    // instead; everything else keeps the original deny-and-redirect
    // behavior.
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isAuthPopupUrl(url)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 500,
            height: 650,
            autoHideMenuBar: true,
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
          },
        };
      }
      // Control center's "Popup-Block": when on, a non-auth popup is
      // dropped entirely (real popup blocking) instead of being turned
      // into a new tab below.
      if (popupBlockEnabled()) return { action: "deny" };
      // Anything that isn't a known auth-popup flow (checked above) still
      // shouldn't spawn a real OS window, but overwriting the CURRENT tab
      // with wherever the popup wanted to go is its own bug: this is the
      // exact path a lot of ad/redirect popups use (e.g. "click a video
      // thumbnail" firing a window.open() to some other site), and having
      // that silently replace the page someone was actually reading is
      // worse than the popup itself. Opens in a new tab instead — close
      // enough to what the site asked for (a separate destination) without
      // either spawning a native window or blowing away the current one.
      const target = trackingParamsEnabled() ? (stripTrackingParams(url) ?? url) : url;
      this.createTab(target);
      return { action: "deny" };
    });
    // Popups created via the "allow" branch above are plain Electron
    // BrowserWindows, not one of our own WebContentsViews — they never go
    // through createTab(), so without this they'd still carry Electron's
    // default UA (the exact problem the UA override above exists to fix)
    // for this one window.
    view.webContents.on("did-create-window", (popup) => {
      popup.webContents.setUserAgent(TAB_USER_AGENT);
    });
    // Right-click on an image, a link, or actual selected text — see
    // main.ts's onContextMenuRequest wiring (showContextMenu) for the full
    // reasoning: this opens a native overlay window (a React-rendered
    // menu, full design control) directly above the tab's live native
    // view — nothing here needs hiding or freezing for it anymore.
    view.webContents.on("context-menu", (_event, params) => {
      this.onContextMenuRequest?.(id, view.webContents, params, this.bounds);
    });
    view.webContents.on("dom-ready", () => view.setBackgroundColor("#ffffff"));
    // Control center globals that need to apply to every NEW tab too, not
    // just the ones open when the toggle was flipped.
    this.applyMasterMuteTo(view.webContents);
    this.applyGlobalDarkModeTo(id, view.webContents);
    if (this.javascriptGloballyDisabled) void this.applyJsToggle(view.webContents, true);
    this.trackConsoleErrors(id, view.webContents);
    this.applyBackgroundThrottleTo(id, view.webContents);
    // HTML5 Fullscreen API (YouTube's fullscreen button, video players,
    // etc.) — a *document* asking to fill the screen, completely separate
    // from F11's OS-level "hide our own chrome" fullscreen (see
    // onShortcutF11 in routes/index.tsx). Without handling this, the page
    // gets exactly nothing: Electron never resizes the WebContentsView
    // past its normal content-area bounds on its own, so a site's
    // `:fullscreen` CSS ends up fighting a view that never actually grew —
    // some sites visibly do nothing, others hide their own chrome via that
    // CSS without their video/canvas filling the (still content-rect-sized)
    // view, which is the blank white page.
    //
    // Reusing the exact win.setFullScreen() the F11 shortcut already calls
    // (see main.ts's enter-full-screen/leave-full-screen → chromeHidden)
    // is deliberate: that already hides our header and resizes this tab's
    // view to the full window through the normal ResizeObserver →
    // tabs:setBounds round-trip — no separate "fullscreen video" bounds
    // logic needed, it's the same path F11 already uses.
    view.webContents.on("enter-html-full-screen", () => this.win.setFullScreen(true));
    // Covers both "site's own exit-fullscreen button" and Escape — Chromium
    // itself already exits the *document's* fullscreen on Escape regardless
    // of anything here, but without this our chrome would stay hidden and
    // the view stuck at full-window size after that happened.
    view.webContents.on("leave-html-full-screen", () => this.win.setFullScreen(false));
    // Ctrl+wheel scroll or a trackpad pinch — Electron detects the native
    // gesture itself and just tells us which direction; actually applying
    // it is on us, same as a real browser's per-page zoom (separate from
    // the Settings → Zoom default below).
    // Single will-navigate handler for both checks below — phishing
    // protection (if a match is found, the real page is never loaded at
    // all) and tracking-parameter stripping (only reached once the URL's
    // already known to be safe, or when phishing protection is off).
    //
    // programmaticNavigationRef guards against an infinite loop: since
    // the safety check is async, preventDefault() has to be called
    // immediately (synchronously) before we even know whether anything
    // needs to change — meaning EVERY navigation ends up going through
    // our own loadURL() call, even ones where nothing changed. That
    // loadURL() call fires ANOTHER will-navigate for the exact same URL,
    // which without this guard would just repeat the whole thing forever.
    let programmaticNavigationUrl: string | null = null;
    // Set right before showing the HTTPS-Only warning page — mirrors
    // bypassPhishingCheckFor above for the same reason: clicking "Continue
    // over unencrypted HTTP" navigates straight to the plain http:// URL,
    // which would otherwise just get silently upgraded back to https by
    // privacy.ts (the exact address that just failed) and land back on
    // this same warning page, making the button appear to do nothing.
    let pendingHttpOnlyBypass: string | null = null;
    view.webContents.on("will-navigate", (event, targetUrl) => {
      if (targetUrl === programmaticNavigationUrl) {
        programmaticNavigationUrl = null;
        return; // our own re-navigation, already checked — let it through untouched
      }
      if (targetUrl === pendingHttpOnlyBypass) {
        pendingHttpOnlyBypass = null;
        allowHttpOnce(targetUrl);
        return; // let it through as plain http, no upgrade, no re-check
      }
      if (!trackingParamsEnabled() && !phishingProtectionEnabled()) return;
      event.preventDefault();
      void (async () => {
        let finalUrl = targetUrl;
        const skipPhishingCheck = targetUrl === this.bypassPhishingCheckFor.get(id);
        this.bypassPhishingCheckFor.delete(id);
        if (phishingProtectionEnabled() && !skipPhishingCheck) {
          const safety = await checkUrlSafety(targetUrl);
          if (!safety.safe) {
            this.bypassPhishingCheckFor.set(id, targetUrl);
            finalUrl = phishingWarningPage(targetUrl, safety.threatType);
          }
        }
        if (finalUrl === targetUrl && trackingParamsEnabled()) {
          finalUrl = stripTrackingParams(targetUrl) ?? targetUrl;
        }
        programmaticNavigationUrl = finalUrl;
        view.webContents.loadURL(finalUrl).catch(() => {
          programmaticNavigationUrl = null;
        });
      })();
    });
    // Powers the per-tab speaker icon in TabStrip.tsx — Chromium tracks
    // "audible" per WebContents already (whether it's CURRENTLY making
    // sound, not just whether it has an <audio>/<video> element at all),
    // this just surfaces that into the tab state the renderer already
    // polls via emit() below.
    view.webContents.on("audio-state-changed", (event) => {
      if (event.audible) this.audibleTabs.add(id);
      else this.audibleTabs.delete(id);
      emit();
    });
    view.webContents.on("zoom-changed", (_event, direction) => {
      const next = stepZoom(view.webContents.getZoomFactor(), direction);
      view.webContents.setZoomFactor(next);
      this.manualZoomTabs.add(id);
    });
    view.webContents.on("did-navigate", () => {
      // A real navigation (not a same-page hash change) starts the new
      // page back at the current default — mirrors Chrome resetting zoom
      // when you leave a site you'd manually zoomed on.
      this.manualZoomTabs.delete(id);
      view.webContents.setZoomFactor(this.defaultZoomFactor);
      // Chromium resets the page-scale/visual-zoom limits on every real
      // navigation, same as it resets zoomFactor above — the call made once
      // at tab creation (before any URL had loaded) only ever covered the
      // very first page. Without reapplying it here, Ctrl+wheel/pinch zoom
      // silently stops doing anything the moment the tab actually navigates
      // anywhere, which is exactly the "zoom works on Start/Settings but not
      // on real sites" symptom.
      view.webContents.setVisualZoomLevelLimits(1, 3).catch(() => {});
      if (!this.homeTabs.has(id) && !this.settingsTabs.has(id))
        this.onNavigate?.(view.webContents.getURL());
      emit();
    });
    view.webContents.on("did-navigate-in-page", emit);
    view.webContents.on("page-title-updated", emit);
    view.webContents.on("did-start-loading", emit);
    view.webContents.on("did-stop-loading", emit);
    view.webContents.on("did-fail-load", (_event, errorCode, _desc, validatedURL, isMainFrame) => {
      // -3 is ERR_ABORTED — fires on completely normal things (the user
      // navigating away before a slow page finished, a redirect chain,
      // etc.), not a real failure, so it's excluded here.
      if (isMainFrame && errorCode !== -3 && !validatedURL.startsWith("data:")) {
        // If this failed URL was silently upgraded from http:// by
        // privacy.ts, the site most likely just doesn't support https at
        // all — a generic "DNS/connection" message would be misleading
        // (the domain is fine, only the forced https attempt wasn't).
        const originalHttp = getOriginalHttpUrl(validatedURL);
        if (originalHttp && httpsOnlyEnabled()) {
          pendingHttpOnlyBypass = originalHttp;
          view.webContents.loadURL(httpsOnlyBlockedPage(originalHttp)).catch(() => {});
        } else if (originalHttp) {
          // HTTPS-Only is off — same as a normal browser's default
          // behavior, fall back to plain http rather than dead-ending on
          // an error for a site that was working fine over http a moment
          // ago.
          allowHttpOnce(originalHttp);
          view.webContents.loadURL(originalHttp).catch(() => {});
        } else {
          view.webContents.loadURL(notAvailablePage(validatedURL, errorCode)).catch(() => {});
        }
      }
      emit();
    });
    // Drives the find-in-page result counter in the header (routes/index.tsx)
    // — only meaningful for whichever tab is currently active, the renderer
    // filters by tabId itself.
    view.webContents.on("found-in-page", (_event, result) => {
      if (this.win.isDestroyed()) return;
      this.win.webContents.send("tabs:foundInPage", {
        tabId: id,
        matches: result.matches,
        activeMatchOrdinal: result.activeMatchOrdinal,
      });
    });

    this.views.set(id, view);
    this.order.push(id);
    this.switchTab(id);
    return id;
  }

  closeTab(id: string) {
    const view = this.views.get(id);
    if (!view) return;

    // Recorded before anything about this tab is torn down, so Ctrl+Shift+T
    // has something to reopen — home/settings tabs are deliberately
    // excluded (reopening "New Tab" or "Settings" isn't what anyone means
    // by "undo closing a tab").
    if (!this.homeTabs.has(id) && !this.settingsTabs.has(id)) {
      const state = this.stateFor(id);
      this.closedTabs.push({ url: state.url, groupId: this.tabGroupOf.get(id) ?? null });
      if (this.closedTabs.length > 15) this.closedTabs.shift();
    }

    // Detach regardless of which slot it was in — a tab being closed is
    // always currently attached (either as the sole active view or as one
    // half of a split), never just sitting inactive in the background.
    if (this.activeId === id || this.secondaryId === id) this.win.contentView.removeChildView(view);
    const wasSecondary = this.secondaryId === id;
    if (wasSecondary) this.secondaryId = null;

    // Same defensive guard as destroy() below — a view's webContents can
    // already be gone (a crashed renderer, a tab closed twice in a fast
    // double-click, ...) and calling .close() on undefined here is
    // exactly the class of bug that crashed the whole app with "Cannot
    // read properties of undefined (reading 'close')" before.
    if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close();
    this.views.delete(id);
    this.globalDarkModeKeys.delete(id);
    this.consoleErrorCounts.delete(id);
    this.unloadedTabUrls.delete(id);
    this.homeTabs.delete(id);
    this.settingsTabs.delete(id);
    this.manualZoomTabs.delete(id);
    this.nightModeTabs.delete(id);
    this.mutedTabs.delete(id);
    this.audibleTabs.delete(id);
    this.openedAt.delete(id);
    this.tabGroupOf.delete(id);
    this.order = this.order.filter((tabId) => tabId !== id);
    this.pruneEmptyGroups();

    // Closing the last open tab closes the whole browser window, same as a
    // normal desktop browser — no "no tabs" limbo state.
    if (this.order.length === 0) {
      this.win.close();
      return;
    }

    if (this.activeId === id) {
      this.activeId = null;
      const next = this.order[this.order.length - 1];
      if (next) this.switchTab(next);
    } else if (wasSecondary && this.contentVisible) {
      // The left-hand tab is still active and still attached — it just
      // needs to go from half-width back to filling the whole area now
      // that split is over.
      const left = this.activeId ? this.views.get(this.activeId) : null;
      left?.setBounds(this.bounds);
    }

    this.emitChange();
  }

  // Drag-reorder from the tab strip — newOrder is the full list of tab ids
  // in their new order (the renderer computes this live as the tab is
  // dragged). Filtered defensively against whatever TabManager actually
  // knows about, so a stale/racy renderer state can't corrupt this.order.
  reorderTabs(newOrder: string[]) {
    const known = new Set(this.order);
    const next = newOrder.filter((id) => known.has(id));
    for (const id of this.order) if (!next.includes(id)) next.push(id);
    if (next.length !== this.order.length) return;
    this.order = next;
    this.emitChange();
  }

  switchTab(id: string) {
    const view = this.views.get(id);
    if (!view || id === this.activeId) return;

    // The old left-hand view always needs detaching, split mode or not —
    // otherwise it's left as an orphaned, still-attached view rendering at
    // its last bounds forever once nothing tracks it anymore.
    if (this.activeId) {
      const prev = this.views.get(this.activeId);
      if (prev) this.win.contentView.removeChildView(prev);
    }

    this.activeId = id;
    // If id happened to be the current right-hand tab, split no longer
    // makes sense (both sides would show the same tab) — fold back to a
    // single view instead of leaving a duplicate.
    if (this.secondaryId === id) this.secondaryId = null;

    // Checked directly here rather than waiting for the renderer to notice
    // isHome/isSettings and call setContentVisible(false) — that's an
    // async round trip, and in the gap before it lands this used to attach
    // the new tab's (blank) native view anyway just because
    // contentVisible was still true from whatever the PREVIOUS tab was.
    // That view could briefly hold real OS keyboard focus, which the
    // renderer's later focus() call on its own search bar can't reliably
    // win back. Deciding it right here, synchronously, closes that gap.
    const newIsInternal = this.homeTabs.has(id) || this.settingsTabs.has(id);

    if (this.contentVisible && !newIsInternal) {
      if (this.secondaryId) {
        this.applySplitLayout();
      } else {
        view.setBounds(this.bounds);
        this.win.contentView.addChildView(view);
      }
    } else if (newIsInternal) {
      // Give real OS keyboard focus back to our own chrome UI right away —
      // no native view was ever attached for this tab in the first place,
      // so there's no async round trip needed before the renderer's
      // search-bar focus() call can actually receive keystrokes.
      this.win.webContents.focus();
    }
    this.emitChange();
  }

  // A rawUrl of HOME_URL/SETTINGS_URL sends the tab to that internal page
  // (rendered by the React chrome itself) instead of loading a real page.
  async navigate(id: string, rawUrl: string) {
    const view = this.views.get(id);
    if (!view) return;

    const clean = rawUrl.trim().replace(/\/+$/, "");
    if (clean === HOME_URL || clean === SETTINGS_URL) {
      this.homeTabs.delete(id);
      this.settingsTabs.delete(id);
      (clean === HOME_URL ? this.homeTabs : this.settingsTabs).add(id);
      view.webContents.loadURL("about:blank").catch(() => {});
      if (id === this.activeId) {
        // Same reasoning as switchTab above — detach and reclaim real
        // keyboard focus right here instead of waiting on the renderer's
        // own async setVisible(false) round trip to eventually do it.
        if (this.secondaryId) {
          this.applySplitLayout();
        } else if (this.win.contentView.children.includes(view)) {
          this.win.contentView.removeChildView(view);
        }
        this.win.webContents.focus();
      } else if (id === this.secondaryId) {
        this.applySplitLayout();
      }
      this.emitChange();
      return;
    }

    let target = this.normalizeUrl(rawUrl);
    if (!target) return;
    // navigate() is the entry point for every "directly typed/clicked"
    // navigation (address bar, favorites, frequent-site suggestions,
    // bookmarks, "open link" from the context menu, ...) - none of that
    // goes through will-navigate below (Electron doesn't emit it for
    // loadURL()-initiated navigations), which is where tracking-param
    // stripping AND the Safe Browsing check otherwise happen. Without
    // running both here too, params only ever got stripped - and
    // dangerous sites only ever got flagged - from navigations a PAGE
    // itself triggered (an in-page link click), never from a URL the
    // person typed or opened directly.
    const skipPhishingCheck = target === this.bypassPhishingCheckFor.get(id);
    this.bypassPhishingCheckFor.delete(id);
    if (phishingProtectionEnabled() && !skipPhishingCheck) {
      const safety = await checkUrlSafety(target);
      if (!safety.safe) {
        this.bypassPhishingCheckFor.set(id, target);
        target = phishingWarningPage(target, safety.threatType);
      }
    }
    // Skip tracking-param stripping when the check above just replaced
    // target with a warning-page data: URL - stripTrackingParams would
    // mangle it, and there's nothing to strip from it anyway.
    if (trackingParamsEnabled() && !target.startsWith("data:"))
      target = stripTrackingParams(target) ?? target;
    this.homeTabs.delete(id);
    this.settingsTabs.delete(id);
    if (this.secondaryId) this.applySplitLayout();
    this.emitChange();
    view.webContents.loadURL(target).catch(() => {});
  }

  goBack(id: string) {
    const wc = this.views.get(id)?.webContents;
    if (wc?.canGoBack()) wc.goBack();
  }

  goForward(id: string) {
    const wc = this.views.get(id)?.webContents;
    if (wc?.canGoForward()) wc.goForward();
  }

  reload(id: string, ignoreCache = false) {
    const wc = this.views.get(id)?.webContents;
    if (!wc) return;
    if (ignoreCache) wc.reloadIgnoringCache();
    else wc.reload();
  }

  // Applied to every tab that hasn't been manually zoomed (see
  // manualZoomTabs), and remembered for tabs created afterwards — this is
  // the Settings → Zoom slider's default, deliberately separate from the
  // interactive per-tab Ctrl+wheel/pinch zoom above.
  setDefaultZoom(factor: number) {
    this.defaultZoomFactor = factor;
    for (const [id, view] of this.views) {
      if (!this.manualZoomTabs.has(id)) view.webContents.setZoomFactor(factor);
    }
  }

  // --- split view -------------------------------------------------------

  private splitBoundsFor(side: "left" | "right"): ContentBounds {
    const GAP = 6; // thin divider strip between the two halves — real gap,
    // not covered by either native view, so a divider line drawn there in
    // the renderer's own DOM is genuinely visible between them.
    const leftWidth = Math.floor((this.bounds.width - GAP) * this.splitRatio);
    return side === "left"
      ? { x: this.bounds.x, y: this.bounds.y, width: leftWidth, height: this.bounds.height }
      : {
          x: this.bounds.x + leftWidth + GAP,
          y: this.bounds.y,
          width: this.bounds.width - leftWidth - GAP,
          height: this.bounds.height,
        };
  }

  // Called continuously while the person drags the divider — ratio is
  // clamped so neither side can be dragged down to nothing.
  setSplitRatio(ratio: number) {
    this.splitRatio = Math.min(0.85, Math.max(0.15, ratio));
    if (this.secondaryId) this.applySplitLayout();
  }

  private applySplitLayout() {
    if (!this.contentVisible) return;
    const leftInternal = this.activeId
      ? this.homeTabs.has(this.activeId) || this.settingsTabs.has(this.activeId)
      : true;
    const rightInternal = this.secondaryId
      ? this.homeTabs.has(this.secondaryId) || this.settingsTabs.has(this.secondaryId)
      : true;

    const leftView = this.activeId ? this.views.get(this.activeId) : null;
    const rightView = this.secondaryId ? this.views.get(this.secondaryId) : null;

    // Any OTHER attached view that isn't currently one of the two active
    // slots (e.g. a side that just navigated to home and should no longer
    // show its now-stale native content) gets detached explicitly — a
    // view lingering here would otherwise keep rendering at its last
    // bounds forever, invisible to any of this method's own bookkeeping.
    for (const [id, view] of this.views) {
      const shouldShow =
        (id === this.activeId && !leftInternal) || (id === this.secondaryId && !rightInternal);
      const isAttached = this.win.contentView.children.includes(view);
      if (isAttached && !shouldShow) this.win.contentView.removeChildView(view);
    }

    if (leftView && !leftInternal) {
      if (!this.win.contentView.children.includes(leftView))
        this.win.contentView.addChildView(leftView);
      leftView.setBounds(this.splitBoundsFor("left"));
    }
    if (rightView && !rightInternal) {
      if (!this.win.contentView.children.includes(rightView))
        this.win.contentView.addChildView(rightView);
      rightView.setBounds(this.splitBoundsFor("right"));
    }
  }

  // Puts `id` on the right half alongside the current active tab (left
  // half). Picking a distinct-from-active tab is the caller's job — the
  // renderer already ensures that before calling this.
  enterSplit(id: string) {
    if (!this.views.has(id) || id === this.activeId) return;
    this.secondaryId = id;
    this.applySplitLayout();
    this.emitChange();
  }

  exitSplit() {
    if (!this.secondaryId) return;
    const right = this.views.get(this.secondaryId);
    if (right) this.win.contentView.removeChildView(right);
    this.secondaryId = null;
    // Restore the active tab back to filling the whole content area.
    const left = this.activeId ? this.views.get(this.activeId) : null;
    if (left && this.contentVisible) left.setBounds(this.bounds);
    this.emitChange();
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  // Exposes the raw WebContents for a tab so electron/browser-tools.ts can
  // run executeJavaScript/findInPage for the AI tools (read_page_text,
  // click_element, ...) without TabManager needing to know about any of
  // that — it only owns tab lifecycle and layout.
  getWebContents(id: string) {
    return this.views.get(id)?.webContents ?? null;
  }

  waitForLoad(id: string, timeoutMs = 15000): Promise<void> {
    const wc = this.views.get(id)?.webContents;
    if (!wc || !wc.isLoading()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wc.removeListener("did-stop-loading", done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      wc.once("did-stop-loading", done);
    });
  }

  setContentBounds(bounds: ContentBounds) {
    this.bounds = bounds;
    if (this.secondaryId) {
      this.applySplitLayout();
      return;
    }
    const active = this.activeId ? this.views.get(this.activeId) : null;
    active?.setBounds(bounds);
  }

  // Hidden while the active tab is an internal page (home/settings) or a
  // dialog is open, so the renderer's own DOM content is visible instead of
  // a native view sitting on top of it.
  setContentVisible(visible: boolean) {
    this.contentVisible = visible;
    if (this.secondaryId) {
      const left = this.activeId ? this.views.get(this.activeId) : null;
      const right = this.views.get(this.secondaryId);
      if (visible) {
        this.applySplitLayout();
      } else {
        if (left) this.win.contentView.removeChildView(left);
        if (right) this.win.contentView.removeChildView(right);
        // A native view can hold real OS-level keyboard focus even after
        // being detached — a JS .focus() call on our own chrome UI's
        // <input> only moves DOM focus within its own renderer, it doesn't
        // by itself pull OS keyboard focus away from whatever webContents
        // last had it. Without this, the renderer's own focus() call on
        // the search bar silently doesn't actually receive keystrokes.
        this.win.webContents.focus();
      }
      return;
    }
    const active = this.activeId ? this.views.get(this.activeId) : null;
    if (!active) return;
    if (visible) {
      active.setBounds(this.bounds);
      this.win.contentView.addChildView(active);
    } else {
      // Resized to nothing rather than removeChildView() — worth trying
      // for the context-menu case specifically (see main.ts's
      // showContextMenu), where every millisecond between "hidden" and
      // "backdrop visible" is a visible cut. Detaching a view outright is
      // a bigger structural change to the window's compositor tree than
      // just shrinking its bounds to zero; a zero-size view still has
      // nothing to actually draw, so the visual result is identical, but
      // this MIGHT be a cheaper operation for Chromium to apply — no way
      // to fully confirm that without watching it run, but it's a safe
      // thing to try since either way nothing from this view is visible.
      active.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      this.win.webContents.focus();
    }
  }

  destroy() {
    for (const view of this.views.values()) {
      // Defensive: a view's webContents can already be gone by the time
      // this runs (e.g. a tab that crashed, or a window torn down in an
      // unusual order) — guard instead of crashing the whole main process.
      if (!view.webContents || view.webContents.isDestroyed()) continue;
      view.webContents.close();
    }
    this.views.clear();
    this.homeTabs.clear();
    this.settingsTabs.clear();
    this.manualZoomTabs.clear();
    this.nightModeTabs.clear();
    this.mutedTabs.clear();
    this.audibleTabs.clear();
    this.groups.clear();
    this.tabGroupOf.clear();
    this.order = [];
    this.activeId = null;
    this.secondaryId = null;
  }

  // --- internals --------------------------------------------------------

  private emitChange() {
    if (this.win.isDestroyed()) return;
    this.win.webContents.send("tabs:changed", this.listTabs());
    this.onStateChange?.();
  }

  private stateFor(id: string): TabState {
    const wc = this.views.get(id)!.webContents;
    const isHome = this.homeTabs.has(id);
    const isSettings = this.settingsTabs.has(id);
    // Falling back to HOME_URL here for a real (non-home/non-settings) tab
    // was meant as a generic "nothing better to show yet" default, but it
    // backfired specifically right after navigate() leaves home/settings
    // for a real URL: emitChange() fires immediately, before
    // webContents.loadURL() has actually updated getURL() past the
    // previous "about:blank" — getURL() briefly returns "" in that gap,
    // which fell through to HOME_URL and flashed the literal
    // "quecksilver://newtab" in the tab strip for a frame. An empty
    // string here instead just shows a blank tab label for that same
    // instant (TabStrip.tsx falls back to tab.title || tab.url), which is
    // unnoticeable — the very next emitChange (did-start-loading) fills
    // in the real title/URL a moment later either way.
    const url = isHome ? HOME_URL : isSettings ? SETTINGS_URL : wc.getURL();
    return {
      id,
      url,
      title: isHome ? "New Tab" : isSettings ? "Settings" : wc.getTitle() || url,
      isLoading: wc.isLoading(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isHome,
      isSettings,
      groupId: this.tabGroupOf.get(id) ?? null,
      nightMode: this.nightModeTabs.has(id),
      isAudible: this.audibleTabs.has(id),
      isMuted: this.mutedTabs.has(id),
      openedAt: this.openedAt.get(id) ?? Date.now(),
    };
  }

  private normalizeUrl(input: string): string | null {
    const value = input.trim();
    if (!value || value === HOME_URL || value === SETTINGS_URL) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(value)) return `https://${value}`;
    return null;
  }
}

// Chromium's own net-error codes (negative, see
// //net/base/net_error_list.h upstream) — mapped to a short set of
// distinct messages instead of one generic "page not available" for
// everything, so a DNS typo, an offline connection, a refused connection,
// and a timeout each read like what they actually are.
function describeNetError(errorCode: number): { title: string; hint: string } {
  switch (errorCode) {
    case -105: // ERR_NAME_NOT_RESOLVED
      return {
        title: "Can't find this site",
        hint: "Check the address for typos, or the site may not exist.",
      };
    case -106: // ERR_INTERNET_DISCONNECTED
      return {
        title: "No internet connection",
        hint: "Check your Wi-Fi or network cable, then try again.",
      };
    case -101: // ERR_CONNECTION_RESET
    case -102: // ERR_CONNECTION_REFUSED
      return {
        title: "This site refused to connect",
        hint: "The site may be down, or blocking connections from here.",
      };
    case -118: // ERR_CONNECTION_TIMED_OUT
    case -7: // ERR_TIMED_OUT
      return {
        title: "This took too long to load",
        hint: "The site didn't respond in time, it may be slow or overloaded.",
      };
    case -200: // ERR_CERT_COMMON_NAME_INVALID (and nearby -2xx are all cert errors)
    case -201:
    case -202:
    case -203:
      return {
        title: "Connection isn't private",
        hint: "This site's security certificate isn't valid, proceeding isn't safe.",
      };
    default:
      return { title: "This page isn't available", hint: "The page couldn't be reached." };
  }
}

// THREAT_LABELS maps Safe Browsing's own threatType strings to something
// a person actually reads, rather than showing "SOCIAL_ENGINEERING" raw.
const THREAT_LABELS: Record<string, string> = {
  MALWARE: "This site has been reported to distribute malware",
  SOCIAL_ENGINEERING: "This site has been reported as a phishing site",
  UNWANTED_SOFTWARE: "This site has been reported to distribute unwanted software",
  POTENTIALLY_HARMFUL_APPLICATION: "This site has been reported as potentially harmful",
};

function httpsOnlyBlockedPage(originalHttpUrl: string): string {
  const safeUrl = originalHttpUrl.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
  );
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>This connection is not secure</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh;
         margin: 0; background: #1f1f24; color: #fff; }
  .box { text-align: center; max-width: 460px; padding: 32px; }
  .icon { width: 48px; height: 48px; margin: 0 auto 20px; }
  h1 { font-size: 19px; font-weight: 700; margin: 0 0 10px; }
  p.hint { font-size: 14px; line-height: 1.5; opacity: 0.85; margin: 0 0 6px; }
  p.url { font-size: 13px; opacity: 0.6; margin: 0 0 26px; word-break: break-all; }
  .buttons { display: flex; flex-direction: column; gap: 10px; align-items: center; }
  button.safe { font: inherit; font-size: 14px; font-weight: 700; color: #1f1f24; background: #fff;
           border: none; border-radius: 8px; padding: 11px 22px; cursor: pointer; width: 220px; }
  button.proceed { font: inherit; font-size: 12px; color: rgba(255,255,255,0.65); background: none;
           border: none; cursor: pointer; text-decoration: underline; }
</style></head>
<body><div class="box">
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5">
    <rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
  </svg>
  <h1>This connection is not secure</h1>
  <p class="hint">HTTPS-Only mode is on, and this site couldn't be reached securely. QueckSilver Arch didn't try the unencrypted version automatically.</p>
  <p class="url">${safeUrl}</p>
  <div class="buttons">
    <button class="safe" id="back">Back to safety</button>
    <button class="proceed" id="proceed">Continue over unencrypted HTTP</button>
  </div>
</div>
<script>
  document.getElementById("back").addEventListener("click", () => history.back());
  document.getElementById("proceed").addEventListener("click", () => {
    location.href = ${JSON.stringify(originalHttpUrl)};
  });
</script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function phishingWarningPage(attemptedUrl: string, threatType: string): string {
  const safeUrl = attemptedUrl.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
  );
  const label = THREAT_LABELS[threatType] ?? "This site has been flagged as dangerous";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Deceptive site ahead</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh;
         margin: 0; background: #7a1414; color: #fff; }
  .box { text-align: center; max-width: 480px; padding: 32px; }
  .icon { width: 56px; height: 56px; margin: 0 auto 20px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 12px; }
  p.hint { font-size: 15px; line-height: 1.5; opacity: 0.92; margin: 0 0 6px; }
  p.url { font-size: 13px; opacity: 0.75; margin: 0 0 28px; word-break: break-all; }
  .buttons { display: flex; flex-direction: column; gap: 10px; align-items: center; }
  button.safe { font: inherit; font-size: 14px; font-weight: 700; color: #7a1414; background: #fff;
           border: none; border-radius: 8px; padding: 11px 22px; cursor: pointer; width: 220px; }
  button.proceed { font: inherit; font-size: 12px; color: rgba(255,255,255,0.7); background: none;
           border: none; cursor: pointer; text-decoration: underline; }
</style></head>
<body><div class="box">
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5">
    <path d="M12 2 2 7v6c0 5.2 3.6 9.4 10 11 6.4-1.6 10-5.8 10-11V7l-10-5Z" />
    <path d="M12 8v5M12 16h.01" stroke-linecap="round"/>
  </svg>
  <h1>Deceptive site ahead</h1>
  <p class="hint">${label}. QueckSilver Arch recommends against continuing to this site.</p>
  <p class="url">${safeUrl}</p>
  <div class="buttons">
    <button class="safe" id="back">Back to safety</button>
    <button class="proceed" id="proceed">Continue anyway (not recommended)</button>
  </div>
</div>
<script>
  document.getElementById("back").addEventListener("click", () => history.back());
  document.getElementById("proceed").addEventListener("click", () => {
    location.href = ${JSON.stringify(attemptedUrl)};
  });
</script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function notAvailablePage(attemptedUrl: string, errorCode = 0): string {
  const safeUrl = attemptedUrl.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
  );
  const { title, hint } = describeNetError(errorCode);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh;
         margin: 0; background: #ffffff; color: #1a1a1a; }
  .box { text-align: center; max-width: 440px; padding: 24px; }
  .icon { width: 48px; height: 48px; margin: 0 auto 16px; color: #9a9a96; }
  h1 { font-size: 19px; font-weight: 600; margin: 0 0 8px; }
  p.hint { font-size: 14px; color: #6b6a66; margin: 0 0 4px; }
  p.url { font-size: 13px; color: #9a9a96; margin: 0 0 20px; word-break: break-all; }
  button { font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: #3a6ea5;
           border: none; border-radius: 8px; padding: 9px 18px; cursor: pointer; }
  button:hover { background: #2f5c8a; }
</style></head>
<body><div class="box">
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/>
  </svg>
  <h1>${title}</h1>
  <p class="hint">${hint}</p>
  <p class="url">${safeUrl}</p>
  <button id="retry">Try again</button>
</div>
<script>
  // JSON.stringify, not the HTML-entity escaping used for safeUrl above —
  // this needs to be safe as a JS STRING LITERAL (quotes/backslashes),
  // which is a different escaping problem than being safe as HTML text.
  // Reusing safeUrl here (or worse, interpolating attemptedUrl raw) would
  // let a URL containing a quote character break out of the string, or
  // just silently reload this error page itself via location.reload()
  // instead of actually retrying the real address.
  document.getElementById("retry").addEventListener("click", () => {
    location.href = ${JSON.stringify(attemptedUrl)};
  });
</script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  dialog,
  shell,
  clipboard,
  nativeImage,
  net as electronNet,
  globalShortcut,
  session as electronSession,
} from "electron";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { TabManager } from "./tab-manager";

// Without this, ANY uncaught exception anywhere in the main process — not
// just the TabManager.destroy() one that's been reported, any future one
// too — kills the whole app with the native "A JavaScript error occurred
// in the main process" dialog and closes every window. That's a much
// worse failure mode than the actual bug behind almost any single one of
// these: losing the whole session over one bad code path in, say, a
// download-tracking callback or a sync request. Logging and continuing
// means a real bug still needs fixing (it'll show up here in the console/
// log), but it no longer takes the entire app down with it. Registered as
// the very first thing this file does, before anything else can throw.
process.on("uncaughtException", (err) => {
  console.error("[main] uncaught exception (app kept running):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandled promise rejection (app kept running):", reason);
});

// Without this, a second launch (double-clicking the installed app while
// a window from an earlier launch — or a dev instance — is still running)
// starts a whole second Electron process that races the first one over
// the exact same userData directory: same disk cache, same GPU cache,
// same service-worker database. That's exactly what produces "Unable to
// move the cache: Access denied" / "Failed to delete the database" on
// Windows — two processes fighting over files the OS only lets one of
// them hold at a time — and separately, why the panic shortcut can fail
// to register ("already claimed by another app"): the FIRST instance
// already holds that global hotkey, so the second one claiming the exact
// same accelerator is rejected by the OS, no third-party app involved at
// all. Must be requested before any window gets created.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to open a second copy — surface the existing window
    // instead of silently doing nothing (or, without the lock above,
    // actually starting a conflicting second process).
    const existing = [...windows.values()][0]?.win;
    if (!existing) return;
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  });
}

import {
  HOME_URL,
  SETTINGS_URL,
  type ActiveIdentity,
  type Bookmark,
  type ContentBounds,
  type HeaderFavorite,
} from "./types";
import { listBookmarks, saveBookmarks } from "./bookmark-store";
import {
  listHeaderFavorites,
  saveHeaderFavorites,
  listHeaderFavoritesForSync,
  overwriteHeaderFavorites,
} from "./favorites-store";
import { getSession, logout, startLoginFlow, cancelLoginFlow } from "./auth";
import { BROWSER_TOOL_NAMES, executeBrowserTool } from "./browser-tools";
import {
  listDownloads,
  getDownloadsFolder,
  setDownloadsFolder,
  removeDownload,
  registerDownloadTracking,
} from "./downloads-store";
import { importChromiumBookmarks, listChromiumProfiles } from "./bookmark-import";
import { importChromiumPasswords } from "./password-import";
import {
  listProfiles,
  createSimpleProfile,
  createQuecksilverProfile,
  renameProfile,
  setActiveProfile,
  enterGuestMode,
  removeProfile,
  getActiveIdentity,
  getActiveProfileId,
  getProfile,
  initWindowIdentity,
  disposeWindowIdentity,
  setPrimaryWindow,
  isPrimaryWindow,
  isGuestMode,
} from "./profile-store";
import { ProfileScopedStore } from "./profile-scoped-store";
import {
  listPasswords,
  addPassword,
  updatePassword,
  removePassword,
  importPasswords,
  findPasswordsForHost,
  autoSaveFromForm,
  listStoredPasswordsForSync,
  overwriteStoredPasswords,
} from "./passwords-store";
import { pullProfileData, syncBookmarks, syncAllNow, mergeAndSync } from "./supabase-sync";
import { applyPrivacyHardening, applyEarlyPrivacySwitches } from "./privacy";
import { autoUpdater } from "electron-updater";
import {
  readSnapshot,
  writeSnapshot,
  lastExitWasClean,
  markRunning,
  markCleanExit,
  getRestoreOnStart,
  setRestoreOnStart,
} from "./session-store";
import { recordVisit, listFrequentSites } from "./frequent-sites-store";
import { getPrivacySettings, setPrivacySettings } from "./privacy-settings-store";
import {
  getControlCenterSettings,
  setControlCenterSettings,
  type ControlCenterSettings,
  type ControlCenterActionRequest,
} from "./control-center-store";
import {
  startTor,
  stopTor,
  onTorStatusChange,
  getTorStatus,
  getSocksProxyRule,
  requestNewIdentity,
} from "./tor-manager";
import {
  listSitePermissions,
  setSitePermission,
  removeSitePermission,
  type PermissionKind,
  type PermissionState,
} from "./site-permissions-store";
import {
  loadStoredExtensions,
  addExtension,
  listExtensions,
  removeExtension,
  setExtensionEnabled,
} from "./extensions-store";
import { existsSync, rmSync, promises as fsPromises } from "node:fs";
import { OverlayWindowManager, registerOverlayIpc } from "./overlay-window";
import type { OverlayAction } from "./overlay-types";
// translatePageInPlace/toggleReaderMode moved into control-center-actions.ts
// along with the rest of the controlCenter:action switch — see below.
import { runControlCenterAction } from "./control-center-actions";
import { buildAppContext } from "./build-app-context";
import { assertControlCenterFieldDescriptionsComplete } from "./control-center-field-descriptions";
import {
  getZoraSettings,
  setZoraSettings,
  setToolPermission,
  type ZoraPreset,
  type ToolPermissionMode,
} from "./zora-settings-store";
import { resolveAllToolPermissions, ZORA_TOOL_CATALOG } from "./zora-tool-catalog";

app.name = "QueckSilver Arch";
// No File/Edit/View/Window/Help bar — this app is deliberately chrome-free
// beyond its own UI (see the master plan: no settings, no menu clutter).
Menu.setApplicationMenu(null);
// Must run here, at module load — command-line switches are only read
// during Chromium's own startup, before app.whenReady() ever fires (see
// privacy.ts for why this specific one exists).
applyEarlyPrivacySwitches();

// Control center's "Autoplay-Block" and "Hardware-Beschleunigung" only
// take effect via Chromium command-line switches / an API that MUST run
// before app.whenReady() — same constraint as applyEarlyPrivacySwitches()
// above. Read once, synchronously, at startup; toggling either setting
// later in Settings/Control center still persists immediately, it just
// needs the next app launch to actually apply (surfaced as a "Neustart
// erforderlich" hint in ControlCenterContent.tsx).
{
  const cc = getControlCenterSettings();
  if (cc.autoplayBlock) app.commandLine.appendSwitch("autoplay-policy", "user-gesture-required");
  if (!cc.hardwareAcceleration) app.disableHardwareAcceleration();
}

// Bundled to CommonJS by scripts/build-electron.mjs, so __dirname is available
// natively here regardless of the app's own package.json "type": "module".
const isDev = process.env.NODE_ENV === "development";
// The chrome UI (tab strip, header, bookmark grid) is just our own React app —
// in dev it's served by `vite dev`, same as opening it in a normal browser.
const CHROME_URL = process.env.ELECTRON_START_URL ?? "http://localhost:8080";
const ICON_PATH = path.join(
  app.getAppPath(),
  "build",
  process.platform === "win32" ? "icon.ico" : "icon-256.png",
);

// Exported (not just module-local) so control-center-actions.ts and
// build-app-context.ts can type their `ctx` parameter against the exact
// same shape via `import type` — no runtime circular import, since
// type-only imports are erased at compile time.
export type WindowEntry = {
  win: BrowserWindow;
  tabs: TabManager;
  contentSession?: Electron.Session;
  overlay: OverlayWindowManager;
};

// Shared across every window's OverlayWindowManager — see
// overlay-window.ts's registerOverlayIpc for why this has to be a single
// Map handed to every instance rather than one per window.
const overlayRegistry = new Map<number, OverlayWindowManager>();
let overlayIpcRegistered = false;

// Same URL story as CHROME_URL/ensureProductionServer above — the overlay
// route is served by the exact same dev server or spawned production
// server as the rest of the chrome UI (it's a TanStack Start route, not a
// separate static file), so it needs the same base URL resolution.
function getChromeBaseUrl(): Promise<string> {
  return isDev ? Promise.resolve(CHROME_URL) : ensureProductionServer();
}

// Every open window, keyed by BrowserWindow.id. Each window has its OWN
// TabManager (own tabs) and its OWN active profile identity (see
// profile-store.ts's per-window identity map) — the whole point of
// "switch profile opens a new window": two windows can be on two
// different profiles (or one profile + one guest) at once, fully
// independent. registerIpc() below is called exactly once and resolves
// which entry an IPC call belongs to per-call, from event.sender, rather
// than ever closing over a single global window/tabs pair.
const windows = new Map<number, WindowEntry>();
let ipcRegistered = false;

// Short-lived, in-memory cache of "last typed username per hostname" — see
// passwords:rememberUsername/getRememberedUsername below. Deliberately
// global (not per-window): the same real-world login flow (e.g. Google)
// looks the same regardless of which window happens to be doing it.
const rememberedUsernames = new Map<string, string>();

// --- Production server ----------------------------------------------------
//
// Dev mode just points at `vite dev` (CHROME_URL). A packaged app has no
// dev server to point at — it needs to serve the built chrome UI itself.
// `npm run build` (see vite.config.ts's `nitro: { preset: "node-server" }`
// override) produces a self-contained Node HTTP server at
// .output/server/index.mjs; this spawns that as a child process using
// Electron's own bundled Node runtime (ELECTRON_RUN_AS_NODE — no separate
// Node.js install needed on the person's machine) and points every window
// at it. One shared server for the whole app, not one per window — it's
// just serving static-ish content, there's no reason to duplicate it.
let productionServerUrl: Promise<string> | null = null;
let productionServerProcess: ChildProcess | null = null;

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

function ensureProductionServer(): Promise<string> {
  if (productionServerUrl) return productionServerUrl;
  productionServerUrl = (async () => {
    const port = await findFreePort();
    // In a packaged app, extraResources (package.json's "build" config)
    // copies .output next to the app as "resources/output". In an
    // unpackaged production test (`electron .` with NODE_ENV production
    // but no installer), app.getAppPath() is the project root instead.
    const serverEntry = app.isPackaged
      ? path.join(process.resourcesPath, "output", "server", "index.mjs")
      : path.join(app.getAppPath(), ".output", "server", "index.mjs");

    const child = fork(serverEntry, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    productionServerProcess = child;
    child.stderr?.on("data", (chunk) => console.error(`[production-server] ${chunk}`));

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Production server didn't start in time")),
        15000,
      );
      child.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Listening on")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Production server exited early (code ${code})`));
      });
    });

    return `http://127.0.0.1:${port}`;
  })();
  return productionServerUrl;
}

app.on("before-quit", () => {
  productionServerProcess?.kill();
  markCleanExit();
});

// Set once at startup, before markRunning() below flips the on-disk flag —
// this is the only source of truth for "did the app crash last time", read
// once here and handed to session:getRecovery for the primary window.
let crashedLastRun = false;

// Debounced so a burst of tab activity (typing a URL, a page's title
// updating a few times while it loads) doesn't hit disk on every single
// change — only the primary window's TabManager ever calls this (see
// createWindow below).
let snapshotWriteTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSnapshotWrite(tabs: TabManager) {
  if (snapshotWriteTimer) clearTimeout(snapshotWriteTimer);
  snapshotWriteTimer = setTimeout(() => writeSnapshot(tabs.snapshot()), 800);
}

function createWindow(identity?: ActiveIdentity): BrowserWindow {
  // Incognito/Tor windows get their own throwaway session partition — no
  // "persist:" prefix, so Electron keeps it in memory only; it simply
  // ceases to exist once this window (its only reference) closes, with
  // nothing ever written to disk. A random UUID per window (not a fixed
  // name reused across windows) means opening two Incognito windows at
  // once are also fully isolated from EACH OTHER, not just from normal
  // browsing — matching how Chrome/Edge's own Incognito windows behave.
  let contentSession: Electron.Session | undefined;
  if (identity?.windowMode === "incognito" || identity?.windowMode === "tor") {
    contentSession = electronSession.fromPartition(`${identity.windowMode}-${randomUUID()}`);
    applyPrivacyHardening(contentSession);
  }
  if (identity?.windowMode === "tor") {
    // Actual SOCKS5 routing is wired up by createTorWindow below, once the
    // Tor process has finished bootstrapping — this only creates the
    // session/partition itself, not the proxy configuration, since that
    // needs to happen before ANY navigation to avoid a request slipping
    // out before Tor is actually ready.
  }

  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title:
      identity?.windowMode === "tor"
        ? "QueckSilver Arch - Tor"
        : identity?.windowMode === "incognito"
          ? "QueckSilver Arch - Incognito"
          : "QueckSilver Arch",
    icon: ICON_PATH,
    backgroundColor:
      identity?.windowMode === "tor"
        ? "#1a1330"
        : identity?.windowMode === "incognito"
          ? "#1f1f24"
          : "#ffffff",
    // Explicit, though it's the default: Windows 11's DWM automatically
    // rounds frameless (frame:false) window corners — that's what makes a
    // full-bleed website (no gap from the true window edge, see the content
    // area below) appear rounded too, same as Edge/Chrome do it. This only
    // works when content actually touches the real window boundary, which
    // is why the p-1.5 gap that used to sit between the content card and
    // the window edge defeated it — removed in routes/index.tsx.
    roundedCorners: true,
    // macOS keeps native traffic lights (titleBarStyle) — no reported issue
    // there. Windows switched to custom-drawn buttons (see TabStrip.tsx):
    // the native titleBarOverlay had two real, unfixable problems — it sits
    // on an OS layer above ALL web content (a dialog's dark backdrop can
    // never reach that corner), and its rendering in fullscreen/maximized
    // state looked inconsistent. Custom buttons avoid both, and are styled
    // to match Windows 11's own caption buttons pixel-for-pixel. Linux has
    // no native equivalent for a hidden frame either way.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 16 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Chromium's native pinch-to-zoom (trackpad pinch, distinct from
  // Ctrl+wheel — see use-page-zoom.ts) applies to this webContents as a
  // whole, header and tab strip included, since they're all the SAME
  // webContents as Start/Settings. That's what competes with the
  // properly-scoped, content-only zoom ZoomedContent/usePageZoom
  // implement in plain CSS. Pinning both limits to 1 is meant to turn
  // native pinch off for this webContents entirely, leaving
  // ZoomedContent's own wheel/pinch listener as the only thing that reacts
  // over Start/Settings. Tab content is unaffected - each browsed page is
  // a separate WebContentsView with its own native zoom, set up
  // independently in tab-manager.ts.
  //
  // ROOT CAUSE of it not actually taking effect: this used to run
  // immediately after `new BrowserWindow(...)`, BEFORE win.loadURL below
  // ever navigates the frame anywhere. There's no renderer frame attached
  // yet at that point for the limits to apply to, so Electron/Chromium
  // silently dropped the call — matching a well-known class of Electron
  // bugs where setVisualZoomLevelLimits appears to "do nothing" (see e.g.
  // electron/electron#24431, #40651). Moving it into 'dom-ready' (fires
  // once the chrome UI's own document has actually attached) and
  // reapplying on every subsequent 'dom-ready' (in case a future
  // navigation resets it) makes it actually stick.
  win.webContents.on("dom-ready", () => {
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  });

  // Second, belt-and-suspenders layer: even with the limits above, some
  // Electron/OS combinations are known to let a native pinch (or, on a
  // couple of platforms, Ctrl+wheel) slip through and change this
  // webContents' own zoomFactor anyway — the exact "everything else zooms
  // too" symptom. 'zoom-changed' fires for that intent regardless of
  // whether the visual limits above actually blocked the visible effect,
  // so snapping zoomFactor straight back to 1 here means the chrome UI's
  // webContents (header, tab strip, Start/Settings alike) can never
  // visibly end up at anything other than 1.0, whatever native path
  // triggered the change. Start/Settings' own zoom still fully works -
  // that's ZoomedContent's separate, JS-driven CSS zoom on just the
  // content div, untouched by this.
  win.webContents.on("zoom-changed", () => {
    win.webContents.setZoomFactor(1);
  });

  // The very first window is "primary" — the only one whose active
  // identity is persisted to disk and resumed on the next app launch (see
  // profile-store.ts). Any window opened afterward via "switch profile"
  // starts from an explicit identity instead (passed in below) and is
  // never itself remembered across a restart. Session snapshotting
  // (crash-recovery/session-restore) follows the exact same rule — only
  // the primary window's tabs are ever persisted. Incognito/Tor windows
  // are additionally never primary regardless of open order (see
  // createIncognitoWindow/createTorWindow — they never touch
  // setPrimaryWindow), since persisting so much as WHICH tabs were open
  // in one defeats a good chunk of the point.
  const isPrimary =
    windows.size === 0 && identity?.windowMode !== "incognito" && identity?.windowMode !== "tor";
  if (isPrimary) setPrimaryWindow(win.id);
  initWindowIdentity(win.id, identity);

  let tabsRef: TabManager | undefined;
  const tabs = new TabManager(
    win,
    isPrimary ? () => tabsRef && scheduleSnapshotWrite(tabsRef) : undefined,
    (url) => recordVisit(win.id, url),
    (tabId, webContents, params, bounds) =>
      showContextMenu(win, tabId, webContents, params, bounds),
    contentSession,
  );
  tabsRef = tabs;

  if (!overlayIpcRegistered) {
    registerOverlayIpc(overlayRegistry);
    overlayIpcRegistered = true;
  }
  // Forwards the chosen action to the SAME window's own chrome
  // webContents, which is where ProfilePopupContent/ContextMenuContent's
  // onAction handling actually lives (see routes/index.tsx, Phase 4) — the
  // overlay window's webContents is a completely separate one.
  const overlay = new OverlayWindowManager(
    win,
    getChromeBaseUrl,
    (action: OverlayAction) => {
      if (!win.isDestroyed()) win.webContents.send("overlay:action", action);
    },
    overlayRegistry,
  );
  windows.set(win.id, { win, tabs, contentSession, overlay });
  // Kicks off the overlay window's one-time native show() (see
  // OverlayWindowManager.warmUp()'s doc comment) well before the person
  // could have opened a real popup yet, so their actual first popup is
  // never the one paying for it.
  overlay.warmUp();

  // Right-click on the chrome UI's OWN rendered content (the Start page,
  // Settings) — a separate listener from TabManager's per-tab one, since
  // this content isn't a tab's native view at all, it's this window's own
  // webContents. Without this, right-clicking anything on Settings or the
  // Start page (a bookmark tile's favicon, selected text in a Settings
  // label, ...) fired a context-menu event nothing was ever listening for.
  win.webContents.on("context-menu", (_event, params) => {
    const activeId = tabs.getActiveId();
    if (activeId)
      showContextMenu(
        win,
        activeId,
        win.webContents,
        params,
        { x: 0, y: 0, width: 0, height: 0 },
        true,
      );
  });

  // "Continue where you left off" is silent — restore right away, no
  // prompt. The crash-recovery prompt (session:getRecovery, answered by
  // routes/index.tsx on mount) is the OTHER path: only offered when
  // restoreOnStart is off AND last exit wasn't clean, so a normal quit
  // followed by a normal restart never nags about it.
  if (isPrimary && getRestoreOnStart()) {
    const snap = readSnapshot();
    if (snap) tabs.restoreSnapshot(snap);
  }

  if (!ipcRegistered) {
    registerIpc();
    ipcRegistered = true;
  }
  attachWindowListeners(win, tabs);

  if (isDev) {
    win.loadURL(CHROME_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    ensureProductionServer()
      .then((url) => win.loadURL(url))
      .catch((err) => {
        console.error("[production-server] failed to start:", err);
        // Falls back to ELECTRON_PROD_URL (a manually-hosted build) if set,
        // so a broken local server doesn't leave the window permanently
        // blank with zero indication why.
        if (process.env.ELECTRON_PROD_URL) win.loadURL(process.env.ELECTRON_PROD_URL);
      });
  }

  win.once("ready-to-show", () => win.show());

  const emitWindowState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("window:stateChanged", { isMaximized: win.isMaximized() });
  };
  win.on("maximize", emitWindowState);
  win.on("unmaximize", emitWindowState);

  // Authoritative source of truth for F11 exiting cleanly — fires no matter
  // how fullscreen was left (F11 again, Escape, Alt+Tab away and back, a
  // Windows snap gesture, ...), so the renderer's chrome-hidden state can
  // never drift out of sync with the window's real fullscreen state.
  const emitFullscreenState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("window:fullscreenChanged", win.isFullScreen());
  };
  win.on("enter-full-screen", emitFullscreenState);
  win.on("leave-full-screen", emitFullscreenState);

  // Runs on "close" (window is about to go away) rather than "closed"
  // (window is already gone) — by the time "closed" fires, Electron has
  // already torn down this window's child WebContentsViews itself, so
  // each view's .webContents is already undefined. tabs.destroy() then
  // crashed the whole main process with "Cannot read properties of
  // undefined (reading 'close')" trying to close an already-gone
  // webContents. Tearing tabs down first, while everything's still alive,
  // fixes that.
  win.on("close", () => {
    tabs.destroy();
  });
  win.on("closed", () => {
    windows.delete(win.id);
    disposeWindowIdentity(win.id);
  });

  return win;
}

// Opens a brand-new, fully independent window already active on the given
// profile (or guest mode) — used by ProfilePopup.tsx's "switch profile"
// flow. The window this was triggered FROM is left completely alone: its
// own active profile, tabs, everything, keep running exactly as before.
function createWindowForProfile(identity: ActiveIdentity) {
  createWindow(identity);
}

// Incognito — a throwaway session partition (see createWindow's own
// handling of identity.windowMode above) and nothing else beyond that.
// No Tor, no proxy, no letterboxing — the deliberately "lighter" of the
// two special modes, matching what Chrome/Edge's own Incognito windows
// promise: nothing is saved, but the browsing itself is exactly as
// visible to the sites you visit and your network as normal browsing.
function createIncognitoWindow(): BrowserWindow {
  return createWindow({ activeProfileId: null, guestMode: true, windowMode: "incognito" });
}

// Tor — creates the window (and its already-isolated session partition,
// handled by createWindow's own identity.windowMode check) up front so
// there's something to show a connecting screen in, THEN starts Tor and
// only routes the session through the SOCKS proxy once bootstrap actually
// reports 100% — routing traffic through a proxy that isn't ready yet
// would just hang every request, not fail safely.
async function createTorWindow(): Promise<BrowserWindow> {
  const win = createWindow({ activeProfileId: null, guestMode: true, windowMode: "tor" });
  const ctx = windows.get(win.id);
  await startTor(getPrivacySettings().torBinaryPath || null);
  // Control center's "VPN-Kill-Switch" (masterplan #6) — once this window
  // has been genuinely routed through Tor at least once, any LATER status
  // that isn't "ready" (Tor crashed, was killed externally, ...) means
  // traffic would otherwise silently keep using whatever proxy was last
  // set — which, since Electron never resets it on its own, is the dead
  // SOCKS port, so requests just hang rather than actually leaking. The
  // kill switch makes that explicit and immediate instead of relying on
  // that as an accident: point the session at an address nothing listens
  // on, so every request fails fast, and tell the connecting screen why.
  let wasConnected = false;
  const unsubscribe = onTorStatusChange((status) => {
    const killSwitchTriggered =
      status.state !== "ready" && wasConnected && getControlCenterSettings().vpnKillSwitch;
    win.webContents.send(
      "tor:statusChanged",
      killSwitchTriggered
        ? { state: "error", message: "Verbindung unterbrochen — Traffic blockiert (Kill-Switch aktiv)" }
        : status,
    );
    if (status.state === "ready" && ctx?.contentSession) {
      wasConnected = true;
      // The CONTENT session (what every tab's WebContentsView actually
      // uses) — not the chrome UI's own webContents.session, which only
      // ever loads this app's own local assets and has no reason to go
      // through Tor at all.
      ctx.contentSession.setProxy({ proxyRules: getSocksProxyRule() }).catch(() => {});
    } else if (killSwitchTriggered && ctx?.contentSession) {
      // Port 1 — nothing binds to it, so every request fails immediately
      // instead of hanging or (worse) ever reaching the network directly.
      ctx.contentSession.setProxy({ proxyRules: "socks5://127.0.0.1:1" }).catch(() => {});
    }
  });
  win.on("closed", () => {
    unsubscribe();
    // Only stop the shared Tor process once no Tor windows remain — two
    // Tor windows open at once should both keep working off the same
    // running Tor process rather than each managing their own.
    const anyTorWindowsLeft = [...windows.values()].some(
      (w) => getActiveIdentity(w.win.id).windowMode === "tor",
    );
    if (!anyTorWindowsLeft) stopTor();
  });
  return win;
}

function attachWindowListeners(win: BrowserWindow, tabs: TabManager) {
  // Surfaces preload load failures (both the chrome UI's own preload.cjs and,
  // via TabManager's onViewCreated below, each tab's tab-preload.cjs) in the
  // terminal running electron:dev — without this, a crash inside a tab's
  // preload script (autofill, link handling) fails completely silently.
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[preload-error] ${preloadPath}:`, error);
  });

  // Global keyboard shortcuts — need to work no matter which view has
  // keyboard focus, including a real page loaded in a tab's native
  // WebContentsView, which never sees the chrome UI's own DOM keydown
  // listener at all (separate content/input context entirely), AND the
  // chrome UI's own webContents (Home/Settings/toolbar focus) — attached to
  // both below. before-input-event fires regardless of focus, so it's used
  // here to relay the keypress back to the chrome as an IPC event, or act
  // on this window's own TabManager directly. Ctrl on Windows/Linux, Cmd
  // on macOS — input.meta is true for Cmd.
  const handleShortcut = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== "keyDown") return;
    const primaryMod = input.control || input.meta;

    if (input.key === "F11") {
      event.preventDefault();
      win.webContents.send("shortcut:f11");
      return;
    }
    if (input.key === "Escape") {
      event.preventDefault();
      win.webContents.send("shortcut:escape");
      return;
    }
    if (input.key === "F12") {
      event.preventDefault();
      const id = tabs.getActiveId();
      if (id) tabs.openDevTools(id);
      return;
    }
    const key = input.key.toLowerCase();

    // Alt+Left/Right — back/forward. Its own modifier, checked before the
    // primaryMod (Ctrl/Cmd) gate below, since it doesn't use that at all.
    if (input.alt && key === "arrowleft") {
      event.preventDefault();
      tabs.goBackActive();
      return;
    }
    if (input.alt && key === "arrowright") {
      event.preventDefault();
      tabs.goForwardActive();
      return;
    }

    if (!primaryMod) return;

    if (key === "t") {
      event.preventDefault();
      if (input.shift) tabs.reopenLastClosedTab();
      else tabs.createTab();
    } else if (key === "w") {
      event.preventDefault();
      tabs.closeActiveTab();
    } else if (key === "r") {
      event.preventDefault();
      tabs.reloadActiveTab(input.shift); // isLoading flips true, which is what actually drives the reload icon's spin animation in the renderer — no separate event needed
    } else if (key === "l") {
      event.preventDefault();
      win.webContents.send("shortcut:focusUrlBar");
    } else if (key === "d") {
      event.preventDefault();
      win.webContents.send("shortcut:addFavorite"); // favorites live in renderer state (useHeaderFavorites), same reasoning as focusing the URL bar
    } else if (key === "f") {
      event.preventDefault();
      win.webContents.send("shortcut:findInPage"); // find bar lives in renderer state, same reasoning as focusUrlBar/addFavorite above
    } else if (key === "a" && input.shift) {
      event.preventDefault();
      win.webContents.send("shortcut:tabSearch"); // tab-search overlay lives entirely in renderer state — all the data (titles/URLs) is already there
    } else if (key === "s" && input.shift) {
      event.preventDefault();
      const id = tabs.getActiveId();
      if (id) void tabs.captureScreenshot(id);
    } else if (key === "s") {
      event.preventDefault();
      const id = tabs.getActiveId();
      if (id) void tabs.savePageAs(id);
    } else if (key === "p") {
      event.preventDefault();
      const id = tabs.getActiveId();
      if (id) tabs.printPage(id);
    } else if (key === "tab") {
      event.preventDefault();
      tabs.cycleTab(input.shift ? "prev" : "next");
    } else if (/^[1-9]$/.test(key)) {
      event.preventDefault();
      tabs.switchToPosition(Number(key));
    }
  };
  win.webContents.on("before-input-event", handleShortcut);
  tabs.onViewCreated((webContents) => webContents.on("before-input-event", handleShortcut));
}

// Resolves which open window (and its TabManager) an IPC call came from —
// every handler below needs this instead of closing over a single global
// window, since several can be open at once (see createWindowForProfile).
// A tab's own WebContentsView resolves to its OWNING top-level window here
// too, same as the chrome UI's own webContents does.
function contextFor(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
): WindowEntry | null {
  const bw = BrowserWindow.fromWebContents(event.sender);
  if (!bw) return null;
  return windows.get(bw.id) ?? null;
}

// --- Image/link context menu actions --------------------------------------
// Module-level (not nested in registerIpc() below) — createWindow() needs
// to hand showContextMenu to TabManager's constructor, and that happens
// for the very first window before registerIpc() ever runs, so anything
// it needs to reference has to already be in scope at that point.
//
// fetchImageBuffer is shared by "copy image" and "save image as" — both
// need the actual bytes, not just the URL, and net.fetch (Electron's
// fetch, respects the same session/cookies as the tab so an auth-gated
// image still works) is the one thing they have in common.
async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await electronNet.fetch(url);
  return Buffer.from(await res.arrayBuffer());
}
async function copyImage(url: string) {
  const buf = await fetchImageBuffer(url);
  clipboard.writeImage(nativeImage.createFromBuffer(buf));
}
async function saveImageAs(url: string) {
  const focused = BrowserWindow.getFocusedWindow();
  const suggestedName = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "image.png");
  const result = await dialog.showSaveDialog(focused ?? undefined!, { defaultPath: suggestedName });
  if (result.canceled || !result.filePath) return;
  const buf = await fetchImageBuffer(url);
  await fsPromises.writeFile(result.filePath, buf);
}
// "Save image" (no "as") — straight to the configured downloads folder,
// same behavior/location as a regular file download.
function saveImageDirect(win: BrowserWindow, url: string) {
  win.webContents.downloadURL(url);
}
function copyLink(url: string) {
  clipboard.writeText(url);
}
function openLinkInNewTab(win: BrowserWindow, url: string) {
  windows.get(win.id)?.tabs.createTab(url);
}
function openLinkInNewWindow(win: BrowserWindow, url: string) {
  const newWin = createWindow({
    activeProfileId: getActiveProfileId(win.id) ?? null,
    guestMode: isGuestMode(win.id),
  });
  const newCtx = windows.get(newWin.id);
  const activeId = newCtx?.tabs.getActiveId();
  if (newCtx && activeId) void newCtx.tabs.navigate(activeId, url);
}
// "Open in InPrivate window" — the favorites bar's own right-click menu
// (src/overlay/FavoriteContextMenuContent.tsx), matching Edge's exact
// wording. Same pattern as openLinkInNewWindow above, just via
// createIncognitoWindow() instead of createWindow() — no profile/guest-
// mode inheritance from the CURRENT window makes sense here, since an
// incognito window is deliberately its own disposable, unlinked session.
function openLinkInIncognitoWindow(url: string) {
  const newWin = createIncognitoWindow();
  const newCtx = windows.get(newWin.id);
  const activeId = newCtx?.tabs.getActiveId();
  if (newCtx && activeId) void newCtx.tabs.navigate(activeId, url);
}
// "Open link" — in the CURRENT tab, same as clicking the link normally
// would (used for the menu's "open" action, distinct from "open in new
// tab/window" above).
function openLinkHere(win: BrowserWindow, tabId: string, url: string) {
  void windows.get(win.id)?.tabs.navigate(tabId, url);
}
// "Save link as…" — downloads whatever the link points to, prompting for
// a save location first. Distinct from saveImageAs: this doesn't fetch
// bytes itself, it lets Electron's normal download machinery (and the
// existing downloads list) handle it, same as a real browser's version of
// this same menu item.
function saveLinkAs(win: BrowserWindow, url: string) {
  win.webContents.downloadURL(url);
}
// --- Right-click menu (image / link / selected text) -----------------------
// Rendered in the native overlay window (see electron/overlay-window.ts) as
// a genuinely separate native window the OS itself layers above the tab's
// live native view — nothing hidden, nothing to freeze/restore around a
// right-click. The bookmark editor, new-group, and tab-search dialogs got
// the same treatment (see src/overlay/{Bookmark,GroupDialog,TabSearch}
// Content.tsx) — nothing in the app hides the native view for a dialog
// anymore, and the screenshot-cache machinery that used to back all of that
// is gone entirely (see tab-manager.ts, preload.ts).
function showContextMenu(
  win: BrowserWindow,
  tabId: string,
  webContents: Electron.WebContents,
  params: Electron.ContextMenuParams,
  bounds: ContentBounds,
  isChromeUI = false,
) {
  const isEmptyPage = params.mediaType !== "image" && !params.linkURL && !params.selectionText;
  // Empty-page menu is suppressed inside a text field (its own edit menu
  // would fit better there — not part of this request) and on the chrome
  // UI's own surfaces (tab strip, Start/Settings chrome) rather than a
  // real page. The image/link/selection menu is unaffected by either.
  if (isEmptyPage && (params.isEditable || isChromeUI)) return;
  const x = params.x + bounds.x;
  const y = params.y + bounds.y;
  windows.get(win.id)?.overlay.open(
    "contextmenu",
    {
      tabId,
      srcURL: params.mediaType === "image" ? params.srcURL || null : null,
      linkURL: params.linkURL || null,
      selectionText: params.selectionText || null,
      isChromeUI,
      isEmptyPage,
      pageUrl: webContents.getURL() || null,
    },
    { top: y, left: x, right: x, bottom: y, placement: "atPoint" },
  );
}

function registerIpc() {
  // --- Overlay windows (Phase 1/2/3 of the native-overlay plan) -----------
  // Opened FROM the chrome UI's own webContents (ProfilePopup's button
  // click, the renderer half of the context menu) — contextFor(event)
  // resolves back to this same window's WindowEntry, same as every other
  // handler here.
  ipcMain.handle(
    "overlay:open",
    (
      event,
      kind: OverlayAction["kind"],
      payload: unknown,
      anchor: { top: number; left: number; right: number; bottom: number },
    ) => {
      if (kind === "downloads")
        console.log(
          `[downloads] overlay:open received in main process, forwarding to OverlayWindowManager — payload=`,
          payload,
        );
      const ctx = contextFor(event);
      if (kind === "downloads" && !ctx)
        console.log(
          `[downloads] contextFor(event) returned null/undefined — the click reached main.ts but the window context lookup failed, so open() never gets called at all`,
        );
      ctx?.overlay.open(kind, payload, anchor);
    },
  );
  ipcMain.handle("overlay:close", (event) => {
    contextFor(event)?.overlay.close();
  });
  ipcMain.handle("overlay:update", (event, kind: OverlayAction["kind"], payload: unknown) => {
    contextFor(event)?.overlay.update(kind, payload);
  });

  // Pushes to Supabase only when the currently active profile (for this
  // window) is QueckSilver-linked AND has a live session — simple profiles
  // and guest mode never call this at all. Centralized here so every local
  // write (bookmarks, header favorites, passwords) triggers the matching
  // sync call the same way instead of duplicating the guard everywhere.
  function syncActiveProfileToCloud(
    windowId: number,
    fn: (session: NonNullable<ReturnType<typeof getSession>>, userId: string) => void,
  ) {
    const activeId = getActiveProfileId(windowId);
    if (!activeId) return;
    const profile = getProfile(activeId);
    if (!profile || profile.kind !== "quecksilver") return;
    const session = getSession(windowId);
    if (!session || !session.userId) return;
    fn(session, session.userId);
  }

  // Conflict-aware push for the two list-shaped columns (header favorites,
  // passwords) — see supabase-sync.ts's mergeAndSync for why this pulls +
  // merges instead of just overwriting the cloud row with whatever's local.
  // The merged result is written back locally too, and (favorites/passwords
  // are both per-profile, per-window) broadcast to that window's renderer —
  // that's what lets something added on another device show up here.
  function syncPasswordsMerged(windowId: number) {
    syncActiveProfileToCloud(windowId, async (session, userId) => {
      try {
        const merged = await mergeAndSync(
          session.accessToken,
          userId,
          "passwords",
          listStoredPasswordsForSync(windowId),
        );
        overwriteStoredPasswords(windowId, merged);
        windows.get(windowId)?.win.webContents.send("passwords:changed", listPasswords(windowId));
      } catch (err) {
        console.error("[sync] passwords merge failed:", err);
      }
    });
  }

  function syncFavoritesMerged(windowId: number) {
    syncActiveProfileToCloud(windowId, async (session, userId) => {
      try {
        const merged = await mergeAndSync(
          session.accessToken,
          userId,
          "header_favorites",
          listHeaderFavoritesForSync(windowId),
        );
        overwriteHeaderFavorites(windowId, merged);
        windows
          .get(windowId)
          ?.win.webContents.send("headerFavorites:changed", listHeaderFavorites(windowId));
      } catch (err) {
        console.error("[sync] favorites merge failed:", err);
      }
    });
  }

  ipcMain.handle("tabs:new", (e, url?: string) => contextFor(e)?.tabs.createTab(url ?? HOME_URL));
  ipcMain.handle("tabs:close", (e, id: string) => contextFor(e)?.tabs.closeTab(id));
  ipcMain.handle("tabs:switch", (e, id: string) => contextFor(e)?.tabs.switchTab(id));
  ipcMain.handle("tabs:list", (e) => contextFor(e)?.tabs.listTabs());
  ipcMain.handle("tabs:reorder", (e, newOrder: string[]) =>
    contextFor(e)?.tabs.reorderTabs(newOrder),
  );
  ipcMain.handle("tabs:navigate", (e, id: string, url: string) =>
    contextFor(e)?.tabs.navigate(id, url),
  );
  ipcMain.handle("tabs:goBack", (e, id: string) => contextFor(e)?.tabs.goBack(id));
  ipcMain.handle("tabs:goForward", (e, id: string) => contextFor(e)?.tabs.goForward(id));
  ipcMain.handle("tabs:reload", (e, id: string, ignoreCache?: boolean) =>
    contextFor(e)?.tabs.reload(id, ignoreCache),
  );
  ipcMain.handle("tabs:setBounds", (e, bounds: ContentBounds) =>
    contextFor(e)?.tabs.setContentBounds(bounds),
  );
  ipcMain.handle("tabs:setVisible", (e, visible: boolean) =>
    contextFor(e)?.tabs.setContentVisible(visible),
  );
  ipcMain.handle("tabs:setDefaultZoom", (e, factor: number) =>
    contextFor(e)?.tabs.setDefaultZoom(factor),
  );
  ipcMain.handle("tabs:enterSplit", (e, id: string) => contextFor(e)?.tabs.enterSplit(id));
  ipcMain.handle("tabs:exitSplit", (e) => contextFor(e)?.tabs.exitSplit());
  ipcMain.handle("tabs:setSplitRatio", (e, ratio: number) =>
    contextFor(e)?.tabs.setSplitRatio(ratio),
  );
  // A tab's native WebContentsView can hold real OS-level keyboard focus
  // even while our own chrome UI is what's visually showing an <input>
  // (the find bar, the URL bar, ...) — a plain DOM .focus() call in the
  // renderer only moves focus within its own process, it doesn't pull
  // real keyboard focus away from the page. This is the same fix
  // TabManager.setContentVisible already applies internally; the find bar
  // needs it explicitly since opening it does NOT hide/detach the tab's
  // view (the page stays visible underneath, only the chrome overlay
  // opens on top of it).
  ipcMain.handle("tabs:focusChrome", (e) => contextFor(e)?.win.webContents.focus());

  // --- Tab groups ------------------------------------------------------------
  ipcMain.handle(
    "tabs:createGroup",
    (e, name: string, color: string) => contextFor(e)?.tabs.createGroup(name, color) ?? null,
  );
  ipcMain.handle("tabs:setGroup", (e, tabId: string, groupId: string | null) =>
    contextFor(e)?.tabs.setTabGroup(tabId, groupId),
  );
  ipcMain.handle("tabs:renameGroup", (e, groupId: string, name: string) =>
    contextFor(e)?.tabs.renameGroup(groupId, name),
  );
  ipcMain.handle("tabs:setGroupColor", (e, groupId: string, color: string) =>
    contextFor(e)?.tabs.setGroupColor(groupId, color),
  );
  ipcMain.handle("tabs:setGroupCollapsed", (e, groupId: string, collapsed: boolean) =>
    contextFor(e)?.tabs.setGroupCollapsed(groupId, collapsed),
  );
  ipcMain.handle("tabs:removeGroup", (e, groupId: string) =>
    contextFor(e)?.tabs.removeGroup(groupId),
  );

  // --- Find-in-page ------------------------------------------------------------
  // Always targets whichever tab is currently active — the find bar in
  // routes/index.tsx only ever shows for the active tab, same as every
  // other browser's Ctrl+F.
  ipcMain.handle("tabs:findInPage", (e, query: string, forward: boolean, findNext: boolean) => {
    const ctx = contextFor(e);
    const activeId = ctx?.tabs.getActiveId();
    if (ctx && activeId) ctx.tabs.findInPage(activeId, query, forward, findNext);
  });
  ipcMain.handle("tabs:stopFindInPage", (e) => {
    const ctx = contextFor(e);
    const activeId = ctx?.tabs.getActiveId();
    if (ctx && activeId) ctx.tabs.stopFindInPage(activeId);
  });

  // --- Picture-in-Picture ------------------------------------------------------
  ipcMain.handle("tabs:togglePiP", async (e) => {
    const ctx = contextFor(e);
    const activeId = ctx?.tabs.getActiveId();
    if (!ctx || !activeId) return "no-video";
    return ctx.tabs.togglePictureInPicture(activeId);
  });
  ipcMain.handle("tabs:toggleNightMode", async (e) => {
    const ctx = contextFor(e);
    const activeId = ctx?.tabs.getActiveId();
    if (!ctx || !activeId) return false;
    return ctx.tabs.toggleNightMode(activeId);
  });
  ipcMain.handle("tabs:toggleNightModeFor", async (e, id: string) => {
    const ctx = contextFor(e);
    if (!ctx) return false;
    return ctx.tabs.toggleNightMode(id);
  });
  ipcMain.handle("tabs:isNightMode", (e, id: string) => {
    const ctx = contextFor(e);
    return ctx ? ctx.tabs.isNightMode(id) : false;
  });
  ipcMain.handle("tabs:toggleMute", (e, id: string) => {
    contextFor(e)?.tabs.toggleMute(id);
  });

  // --- Image/link/right-click IPC wrappers -----------------------------
  // The actual logic (fetchImageBuffer, copyImage, saveImageAs,
  // saveImageDirect, copyLink, openLinkInNewTab/Window, showContextMenu)
  // lives at module scope above registerIpc() — createWindow() needs to
  // hand showContextMenu to TabManager before registerIpc() ever runs for
  // the very first window, so it couldn't be defined only in here.
  ipcMain.handle("images:copy", (_e, url: string) => copyImage(url));
  ipcMain.handle("images:save", (_e, url: string) => saveImageAs(url));
  ipcMain.handle("images:saveDirect", (e, url: string) => {
    const ctx = contextFor(e);
    if (ctx) saveImageDirect(ctx.win, url);
  });
  ipcMain.handle("links:copy", (_e, url: string) => copyLink(url));
  ipcMain.handle("links:openInNewTab", (e, url: string) => {
    const ctx = contextFor(e);
    if (ctx) openLinkInNewTab(ctx.win, url);
  });
  ipcMain.handle("links:openInNewWindow", (e, url: string) => {
    const ctx = contextFor(e);
    if (ctx) openLinkInNewWindow(ctx.win, url);
  });
  ipcMain.handle("links:openInIncognitoWindow", (_e, url: string) =>
    openLinkInIncognitoWindow(url),
  );
  ipcMain.handle("links:openHere", (e, tabId: string, url: string) => {
    const ctx = contextFor(e);
    if (ctx) openLinkHere(ctx.win, tabId, url);
  });
  ipcMain.handle("links:saveAs", (e, url: string) => {
    const ctx = contextFor(e);
    if (ctx) saveLinkAs(ctx.win, url);
  });
  ipcMain.handle("images:copyLink", (_e, url: string) => copyLink(url));
  ipcMain.handle("tabs:copySelectionFor", (e, tabId: string) => {
    contextFor(e)?.tabs.copySelection(tabId);
  });

  // --- Session recovery / restore ------------------------------------------
  // Answered once, on mount, by routes/index.tsx — only ever meaningful for
  // the primary window (see createWindow's isPrimary handling above); any
  // other window just gets "nothing to offer".
  ipcMain.handle("session:getRecovery", (e) => {
    const ctx = contextFor(e);
    const snap = readSnapshot();
    if (!ctx || !isPrimaryWindow(ctx.win.id) || !snap || getRestoreOnStart() || !crashedLastRun) {
      return { available: false, tabCount: 0, crashed: false };
    }
    // A snapshot made up entirely of blank Start-page tabs (someone closed
    // down to just a fresh new tab, then the app happened to crash/quit
    // from there) has nothing worth offering to restore — every one of
    // those tabs reopens to the exact same empty page a normal launch
    // already shows, so the prompt would just be nagging over nothing.
    const realTabs = snap.tabs.filter((t) => t.url !== HOME_URL);
    if (realTabs.length === 0) {
      return { available: false, tabCount: 0, crashed: false };
    }
    return { available: true, tabCount: realTabs.length, crashed: true };
  });
  ipcMain.handle("session:restoreAccepted", (e) => {
    const ctx = contextFor(e);
    const snap = readSnapshot();
    if (ctx && snap) ctx.tabs.restoreSnapshot(snap);
  });
  ipcMain.handle("session:restoreDismissed", () => {
    /* nothing to do — the person chose to keep the fresh Start tab */
  });
  ipcMain.handle("session:getRestoreOnStart", () => getRestoreOnStart());
  ipcMain.handle("frequentSites:list", (e, prefix: string) => {
    const ctx = contextFor(e);
    return ctx ? listFrequentSites(ctx.win.id, prefix) : [];
  });
  // Same data as "frequentSites:list" above, just reached from the overlay
  // window's own separate preload/webContents (see overlay-preload.ts's
  // frequentSites and src/overlay/types.ts's BookmarkOverlayPayload
  // comment) — contextFor doesn't work here since the overlay
  // BrowserWindow's id was never added to the `windows` Map, so this
  // resolves the OWNER window's id via the overlay registry instead.
  ipcMain.handle("overlay:frequentSites", (e, prefix: string) => {
    const bw = BrowserWindow.fromWebContents(e.sender);
    const ownerId = bw ? overlayRegistry.get(bw.id)?.ownerWindowId : null;
    return ownerId != null ? listFrequentSites(ownerId, prefix) : [];
  });
  ipcMain.handle("permissions:list", (e) => {
    const ctx = contextFor(e);
    return ctx ? listSitePermissions(ctx.win.id) : [];
  });
  ipcMain.handle(
    "permissions:set",
    (e, domain: string, kind: PermissionKind, state: PermissionState) => {
      const ctx = contextFor(e);
      if (ctx) setSitePermission(ctx.win.id, domain, kind, state);
    },
  );
  ipcMain.handle("permissions:remove", (e, domain: string) => {
    const ctx = contextFor(e);
    if (ctx) removeSitePermission(ctx.win.id, domain);
  });
  ipcMain.handle("extensions:list", () => listExtensions());
  ipcMain.handle("extensions:addFromFolder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      return await addExtension(result.filePaths[0]);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to load extension" };
    }
  });
  ipcMain.handle("extensions:remove", (_e, id: string) => removeExtension(id));
  ipcMain.handle("extensions:setEnabled", (_e, id: string, enabled: boolean) =>
    setExtensionEnabled(id, enabled),
  );
  ipcMain.handle("privacy:get", () => getPrivacySettings());
  ipcMain.handle("privacy:set", (_e, patch: Partial<ReturnType<typeof getPrivacySettings>>) => {
    // panicShortcut goes through updatePanicShortcut (re-registers the
    // global shortcut immediately); everything else is a plain setting
    // with no side effect beyond being read on the next relevant check.
    if (patch.panicShortcut !== undefined) updatePanicShortcut(patch.panicShortcut);
    const { panicShortcut: _omit, ...rest } = patch;
    return setPrivacySettings(rest);
  });
  ipcMain.handle("app:installUpdate", () => autoUpdater.quitAndInstall());
  ipcMain.handle("session:setRestoreOnStart", (_e, value: boolean) => setRestoreOnStart(value));

  // --- Control center --------------------------------------------------
  // Backs the new top-left Control center dropdown (replaced the old
  // chevron/tabsMenu-only button, see ControlCenterContent.tsx). Plain
  // get/set for the persisted flags, plus a single "action" channel for
  // one-shot commands (open devtools, screenshot, ...) that don't belong
  // in the settings object itself.
  ipcMain.handle("controlCenter:get", () => getControlCenterSettings());
  ipcMain.handle("controlCenter:set", async (e, patch: Partial<ControlCenterSettings>) => {
    const next = setControlCenterSettings(patch);
    const ctx = contextFor(e);

    // Side effects that need to touch every open tab right now, not just
    // be read lazily on the next request/permission check.
    if (patch.masterMute !== undefined) ctx?.tabs.setMasterMute(patch.masterMute);
    if (patch.darkModeForced !== undefined) await ctx?.tabs.setGlobalDarkMode(patch.darkModeForced);
    if (patch.javascriptDisabled !== undefined)
      await ctx?.tabs.setJavaScriptGloballyDisabled(patch.javascriptDisabled);
    if (patch.globalZoomFactor !== undefined) ctx?.tabs.setDefaultZoom(patch.globalZoomFactor);
    if (patch.backgroundTabsThrottled !== undefined)
      ctx?.tabs.setBackgroundTabsThrottled(patch.backgroundTabsThrottled);

    // VPN toggle is an alias for the existing Tor manager — this app has
    // no other anonymization layer, see the masterplan's open question
    // about a real VPN protocol vs. Tor.
    if (patch.vpnEnabled !== undefined) {
      if (patch.vpnEnabled)
        await startTor().catch((err) =>
          console.error("[control-center] VPN (Tor) start failed:", err),
        );
      else stopTor();
    }

    // DNS-over-HTTPS toggle is an alias for the existing privacy-settings
    // store's dohProvider — uses whichever provider is currently selected
    // via dnsOverHttpsProvider (defaults to cloudflare) instead of always
    // hardcoding cloudflare.
    if (patch.dnsOverHttpsEnabled !== undefined) {
      const provider = patch.dnsOverHttpsProvider ?? next.dnsOverHttpsProvider;
      setPrivacySettings({ dohProvider: patch.dnsOverHttpsEnabled ? provider : "off" });
    } else if (patch.dnsOverHttpsProvider !== undefined && next.dnsOverHttpsEnabled) {
      // Provider changed while DoH was already on — re-point immediately
      // instead of waiting for the enabled flag to be toggled again.
      setPrivacySettings({ dohProvider: patch.dnsOverHttpsProvider });
    }

    // HTTPS-Only toggle is an alias for the existing privacy-settings
    // store's httpsOnly (same "control center pushes into the real
    // setting" pattern as dnsOverHttpsEnabled above) — the actual hard-
    // block behavior already lives in tab-manager.ts's did-fail-load
    // handler, this only flips the flag it reads.
    if (patch.httpsOnlyEnforced !== undefined) {
      setPrivacySettings({ httpsOnly: patch.httpsOnlyEnforced });
    }

    if (patch.visionFilter !== undefined) await ctx?.tabs.setVisionFilter(patch.visionFilter);
    if (patch.cursorSize !== undefined) await ctx?.tabs.setCursorSize(patch.cursorSize);
    if (patch.gridOverlayEnabled !== undefined) await ctx?.tabs.setGridOverlay(patch.gridOverlayEnabled);
    if (patch.userAgentPreset !== undefined) ctx?.tabs.setUserAgentPreset(patch.userAgentPreset);
    // Battery saver is a UI-level preset (see ControlCenterContent.tsx's
    // onChange for this field, which patches backgroundTabsThrottled +
    // unloadBackgroundTabsOnIdle in the SAME request) — nothing extra to
    // apply here beyond persisting the flag itself, already done by
    // setControlCenterSettings(patch) above.

    return next;
  });
  // Full switch moved to control-center-actions.ts's runControlCenterAction()
  // — Zora's run_control_center_tool dispatches to the exact same function,
  // see zora-browser-integration-plan.md section 7.
  ipcMain.handle("controlCenter:action", async (e, action: ControlCenterActionRequest) => {
    const ctx = contextFor(e);
    if (!ctx) return null;
    return runControlCenterAction(ctx, action);
  });
  ipcMain.handle(
    "controlCenter:consoleErrorTotal",
    (e) => contextFor(e)?.tabs.getTotalConsoleErrorCount() ?? 0,
  );
  ipcMain.handle("controlCenter:trackerCountForActiveTab", (e) => {
    const ctx = contextFor(e);
    const activeId = ctx?.tabs.getActiveId();
    return activeId ? ctx.tabs.getTrackerCountForTab(activeId) : 0;
  });
  // Control center's "Bandbreiten-Nutzung" (masterplan #10) — same
  // polling shape as the tracker counter above.
  ipcMain.handle("controlCenter:bandwidthForActiveTab", (e) => {
    const ctx = contextFor(e);
    const activeId = ctx?.tabs.getActiveId();
    return activeId ? ctx.tabs.getBandwidthForTab(activeId) : 0;
  });
  // Control center's "Live RAM/CPU-Anzeige" (masterplan #11).
  ipcMain.handle("controlCenter:resourceUsageForActiveTab", (e) => {
    const ctx = contextFor(e);
    const activeId = ctx?.tabs.getActiveId();
    return activeId ? ctx.tabs.getResourceUsageForTab(activeId) : null;
  });
  // Custom CSS pro Domain (masterplan #16) — pre-fills the Tools editor
  // with whatever's already saved for the active tab's domain.
  ipcMain.handle("controlCenter:customCssForActiveTab", (e) => {
    const ctx = contextFor(e);
    const activeId = ctx?.tabs.getActiveId();
    return activeId ? ctx.tabs.getCustomCssForTab(activeId) : null;
  });
  ipcMain.handle("controlCenter:currentSiteSafety", (e) => {
    const ctx = contextFor(e);
    const activeId = ctx?.tabs.getActiveId();
    return activeId ? ctx.tabs.getSiteSafetyForTab(activeId) : "unknown";
  });

  ipcMain.handle("bookmarks:list", (e) => listBookmarks(contextFor(e)?.win.id ?? -1));
  ipcMain.handle("bookmarks:save", (e, bookmarks: Bookmark[]) => {
    const ctx = contextFor(e);
    if (!ctx) return;
    saveBookmarks(ctx.win.id, bookmarks);
    ctx.win.webContents.send("bookmarks:changed", bookmarks);
    syncActiveProfileToCloud(ctx.win.id, (session, userId) =>
      syncBookmarks(session.accessToken, userId, bookmarks),
    );
  });

  // Header bookmarks bar — separate list from the 5 home-page slots above.
  ipcMain.handle("headerFavorites:list", (e) => listHeaderFavorites(contextFor(e)?.win.id ?? -1));
  ipcMain.handle("headerFavorites:save", (e, favorites: HeaderFavorite[]) => {
    const ctx = contextFor(e);
    if (!ctx) return;
    saveHeaderFavorites(ctx.win.id, favorites);
    ctx.win.webContents.send("headerFavorites:changed", favorites);
    syncFavoritesMerged(ctx.win.id);
  });

  // --- Profiles ------------------------------------------------------------
  ipcMain.handle("profiles:list", () => listProfiles());
  ipcMain.handle("profiles:getActive", (e) => {
    const ctx = contextFor(e);
    return ctx ? getActiveIdentity(ctx.win.id) : { activeProfileId: null, guestMode: true };
  });
  ipcMain.handle("profiles:createSimple", (e, name: string) => {
    const ctx = contextFor(e);
    if (!ctx) return null;
    return createSimpleProfile(ctx.win, name);
  });
  ipcMain.handle("profiles:rename", (e, id: string, name: string) => {
    const ctx = contextFor(e);
    if (ctx) renameProfile(ctx.win, id, name);
  });
  // Switches THIS window's active profile in place — used only for actions
  // that are meant to affect the current window (none currently call this
  // directly from the UI; kept for completeness / potential future use).
  // "Switch to a different profile" from ProfilePopup.tsx goes through
  // profiles:openInNewWindow instead, see below.
  ipcMain.handle("profiles:setActive", (e, id: string) => {
    const ctx = contextFor(e);
    if (ctx) setActiveProfile(ctx.win, id);
  });
  ipcMain.handle("profiles:enterGuest", (e) => {
    const ctx = contextFor(e);
    if (!ctx) return;
    ProfileScopedStore.clearGuestMemoryFor(ctx.win.id);
    enterGuestMode(ctx.win);
  });
  // "Switch profile" always opens a brand-new window already on that
  // profile (or guest mode) — the window this was called from is left
  // exactly as it was, still on whatever it had active before.
  ipcMain.handle("profiles:openInNewWindow", (_e, identity: ActiveIdentity) => {
    if (identity.windowMode === "tor") {
      void createTorWindow();
      return;
    }
    createWindowForProfile(identity);
  });

  // --- Tor -------------------------------------------------------------
  ipcMain.handle("tor:getStatus", () => getTorStatus());
  ipcMain.handle("tor:newIdentity", async (e) => {
    const ctx = contextFor(e);
    if (!ctx) return;
    await requestNewIdentity().catch((err) =>
      console.error("[tor] new identity request failed:", err),
    );
    // A new circuit alone isn't a full reset — the old session partition
    // (cookies, storage, whatever a site set) would still be sitting
    // there, and every open tab would still be showing whatever page it
    // had loaded under the OLD identity. Clearing the partition's storage
    // AND closing every tab in favor of one fresh Start tab is what makes
    // this a genuinely clean slate, matching what Tor Browser's own "New
    // Identity" does (it restarts the whole browser).
    await ctx.contentSession?.clearStorageData().catch(() => {});
    await ctx.contentSession?.clearCache().catch(() => {});
    // New tab created FIRST — closeTab() on the last remaining tab closes
    // the whole window (same as closing a real browser's last tab), so
    // looping through and closing every OLD tab before this exists would
    // take the window down before a fresh one was ever there to land on.
    const freshTabId = ctx.tabs.createTab();
    for (const tab of ctx.tabs.listTabs().tabs) {
      if (tab.id !== freshTabId) ctx.tabs.closeTab(tab.id);
    }
  });
  ipcMain.handle("profiles:remove", (e, id: string) => {
    const ctx = contextFor(e);
    if (!ctx) return;
    const profileDir = path.join(app.getPath("userData"), "profiles", id);
    removeProfile(ctx.win, id);
    if (existsSync(profileDir)) {
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch (err) {
        console.error("[profiles] failed to delete profile data:", err);
      }
    }
  });
  // Manual "Sync now" from the profile card in ProfilePopup.tsx — pushes
  // favorites/bookmarks/passwords immediately instead of waiting on the
  // fire-and-forget sync that already happens after every local change.
  // Mostly useful as a visible "yes, this is actually syncing" confirmation
  // (the automatic sync gives no feedback at all).
  ipcMain.handle("profiles:syncNow", async (e) => {
    const ctx = contextFor(e);
    if (!ctx) return false;
    const windowId = ctx.win.id;
    const activeId = getActiveProfileId(windowId);
    const profile = activeId ? getProfile(activeId) : null;
    const session = getSession(windowId);
    if (!profile || profile.kind !== "quecksilver" || !session?.accessToken || !session.userId)
      return false;
    return syncAllNow(session.accessToken, session.userId, {
      header_favorites: listHeaderFavorites(windowId),
      bookmarks: listBookmarks(windowId),
      passwords: listPasswords(windowId),
    });
  });

  // --- Passwords -----------------------------------------------------------
  ipcMain.handle("passwords:list", (e) => listPasswords(contextFor(e)?.win.id ?? -1));
  ipcMain.handle("passwords:add", (e, url: string, username: string, password: string) => {
    const ctx = contextFor(e);
    if (!ctx) return null;
    const entry = addPassword(ctx.win.id, url, username, password);
    ctx.win.webContents.send("passwords:changed", listPasswords(ctx.win.id));
    syncPasswordsMerged(ctx.win.id);
    return entry;
  });
  ipcMain.handle(
    "passwords:update",
    (e, id: string, url: string, username: string, password?: string) => {
      const ctx = contextFor(e);
      if (!ctx) return null;
      const entry = updatePassword(ctx.win.id, id, url, username, password);
      ctx.win.webContents.send("passwords:changed", listPasswords(ctx.win.id));
      syncPasswordsMerged(ctx.win.id);
      return entry;
    },
  );
  ipcMain.handle("passwords:remove", (e, id: string) => {
    const ctx = contextFor(e);
    if (!ctx) return;
    removePassword(ctx.win.id, id);
    ctx.win.webContents.send("passwords:changed", listPasswords(ctx.win.id));
    syncPasswordsMerged(ctx.win.id);
  });
  ipcMain.handle("passwords:import", async (e, browser: "chrome" | "edge", profileId: string) => {
    const ctx = contextFor(e);
    const extracted = await importChromiumPasswords(browser, profileId);
    if (extracted.error || !ctx) return extracted;
    const result = importPasswords(ctx.win.id, extracted.entries);
    ctx.win.webContents.send("passwords:changed", listPasswords(ctx.win.id));
    syncPasswordsMerged(ctx.win.id);
    return { imported: result.imported, skipped: result.skipped, error: null };
  });
  // Called from tab-preload.ts's autofill logic, once per real page load —
  // returns saved logins matching the page's hostname (loose subdomain
  // match, see findPasswordsForHost in passwords-store.ts).
  ipcMain.handle("passwords:findForHost", (e, host: string) => {
    const ctx = contextFor(e);
    if (!ctx) return [];
    const matches = findPasswordsForHost(ctx.win.id, host);
    console.log(
      `[passwords] findForHost(${host}) -> ${matches.length} match(es)${matches.length > 1 ? ` [${matches.map((m) => m.username).join(", ")}]` : ""}, have ${listPasswords(ctx.win.id).length} saved total`,
    );
    return matches;
  });
  // Called from tab-preload.ts's password picker dropdown's "Manage
  // passwords" footer link — relays to the chrome UI, which both switches
  // to (or opens) the Settings tab AND scrolls straight to the Passwords
  // section, same mechanism as clicking Settings → Passwords normally.
  ipcMain.handle("passwords:openManageSettings", (e) => {
    contextFor(e)?.win.webContents.send("shortcut:openPasswordSettings");
  });
  // Many real login flows (Google among them) ask for the username/email
  // on one step and the password on a separate later step/navigation —
  // the username field is simply gone from the DOM by the time the
  // password field shows up, so tab-preload.ts can't find both together.
  // This short-lived, in-memory cache (never written to disk, gone on
  // restart) remembers whatever was last typed into a username-looking
  // field per hostname, so the password step can still pair it up.
  ipcMain.on(
    "passwords:rememberUsername",
    (_e, { host, username }: { host: string; username: string }) => {
      if (username) rememberedUsernames.set(host, username);
    },
  );
  ipcMain.handle(
    "passwords:getRememberedUsername",
    (_e, host: string) => rememberedUsernames.get(host) ?? null,
  );
  // Called from tab-preload.ts's submit/click listener — saves silently
  // and, if it actually changed anything, tells the chrome UI to show the
  // brief "Password for X saved" pill (routes/index.tsx).
  ipcMain.handle(
    "passwords:autoSaveFromForm",
    (e, { url, username, password }: { url: string; username: string; password: string }) => {
      const ctx = contextFor(e);
      console.log(
        `[passwords] autoSaveFromForm(url=${url}, username=${username ? "<set>" : "<empty>"}, password=${password ? "<set>" : "<empty>"})`,
      );
      if (!ctx) return null;
      const saved = autoSaveFromForm(ctx.win.id, url, username, password);
      if (!saved) {
        console.log(
          "[passwords] autoSaveFromForm: nothing changed (identical to an already-saved entry, or no password)",
        );
        return null;
      }
      ctx.win.webContents.send("passwords:changed", listPasswords(ctx.win.id));
      ctx.win.webContents.send("passwords:autoSaved", { url: saved.url, username: saved.username });
      syncPasswordsMerged(ctx.win.id);
      return saved;
    },
  );

  ipcMain.handle("auth:getSession", (e) => getSession(contextFor(e)?.win.id ?? -1));
  // mode "new-profile" creates + activates a brand-new quecksilver profile
  // once the email is known; "reauth" refreshes the session of whichever
  // quecksilver profile is already active (its token went stale) without
  // touching the profile list at all.
  ipcMain.handle("auth:login", async (e, mode: "new-profile" | "reauth") => {
    const ctx = contextFor(e);
    if (!ctx) return null;
    const { win } = ctx;
    const session = await startLoginFlow(win, (email) => {
      if (mode === "new-profile") createQuecksilverProfile(win, email);
    });
    // If this QueckSilver account already has data in the cloud (a
    // returning user on a fresh install, a second device, or signing back
    // in on this same device), pull it down now instead of leaving
    // favorites/bookmarks/passwords empty until something happens to
    // trigger a push.
    //
    // header_favorites/passwords go through the same merge used for every
    // other sync (see supabase-sync.ts's mergeAndSync) rather than a raw
    // overwrite — createQuecksilverProfile above now reuses an existing
    // local profile for a returning email instead of always creating an
    // empty one, so there CAN be local data here worth not clobbering
    // (e.g. something added offline since the last sync). Bookmarks have
    // no per-item merge (5 fixed positional slots, not a list of ids), so
    // those still just take the cloud copy — but only when there's
    // nothing local to lose.
    if (mode === "new-profile" && session?.accessToken && session.userId) {
      try {
        const remote = await pullProfileData(session.accessToken, session.userId);
        if (remote) {
          if (Array.isArray(remote.header_favorites)) {
            const merged = await mergeAndSync(
              session.accessToken,
              session.userId,
              "header_favorites",
              listHeaderFavoritesForSync(win.id),
            );
            overwriteHeaderFavorites(win.id, merged);
            win.webContents.send("headerFavorites:changed", listHeaderFavorites(win.id));
          }
          if (
            Array.isArray(remote.bookmarks) &&
            remote.bookmarks.length > 0 &&
            listBookmarks(win.id).length === 0
          ) {
            saveBookmarks(win.id, remote.bookmarks as Bookmark[]);
            win.webContents.send("bookmarks:changed", listBookmarks(win.id));
          }
          if (Array.isArray(remote.passwords)) {
            const merged = await mergeAndSync(
              session.accessToken,
              session.userId,
              "passwords",
              listStoredPasswordsForSync(win.id),
            );
            overwriteStoredPasswords(win.id, merged);
            win.webContents.send("passwords:changed", listPasswords(win.id));
          }
        } else {
          console.warn(
            "[auth:login] pullProfileData returned nothing for this account — either it has no synced data yet, or the search_profile_data table/RLS policy isn't set up in Supabase (see supabase/search_profile_data.sql).",
          );
        }
      } catch (err) {
        console.error("[auth:login] pulling cloud data after login failed:", err);
      }
    }
    return session;
  });
  ipcMain.handle("auth:cancelLogin", (e) => {
    const ctx = contextFor(e);
    if (ctx) cancelLoginFlow(ctx.win.id);
  });
  ipcMain.handle("auth:logout", (e) => {
    const ctx = contextFor(e);
    if (ctx) logout(ctx.win.id);
  });

  // Downloads — one tracker for the whole app (not per-window, not per-
  // tab), matching how real browsers show one shared downloads list
  // regardless of which window a file was downloaded from.
  registerDownloadTracking(() => {
    for (const { win } of windows.values())
      win.webContents.send("downloads:changed", listDownloads());
  });
  ipcMain.handle("downloads:list", () => listDownloads());
  ipcMain.handle("downloads:remove", (_e, id: string) => {
    removeDownload(id);
    for (const { win } of windows.values())
      win.webContents.send("downloads:changed", listDownloads());
  });
  // Types Electron/Chromium can render inline (plugins:true on every tab's
  // WebContentsView enables the built-in PDF viewer — see tab-manager.ts)
  // open in a fresh QueckSilver Arch tab instead of shell.openPath()'s
  // normal behavior. shell.openPath() hands the file to whatever Windows
  // has registered as the DEFAULT APP FOR THAT FILE EXTENSION — a
  // completely separate registration from "default browser" (which only
  // covers the http/https protocol, not local file associations), so even
  // an already-default-browser QueckSilver Arch would still lose these
  // to Edge/whatever else owns .html/.pdf/.svg on the machine. This is
  // the actual cause of "opens in another browser" for downloaded PDFs/
  // HTML/SVG files clicked from QueckSilver Arch's own downloads list.
  const INLINE_VIEWABLE_EXTENSIONS = new Set([".pdf", ".html", ".htm", ".svg"]);
  ipcMain.handle("downloads:open", (e, filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    if (INLINE_VIEWABLE_EXTENSIONS.has(ext)) {
      const ctx = contextFor(e);
      if (ctx) {
        ctx.tabs.createTab(`file://${filePath.replace(/\\/g, "/")}`);
        return;
      }
    }
    return shell.openPath(filePath);
  });
  ipcMain.handle("downloads:showInFolder", (_e, filePath: string) =>
    shell.showItemInFolder(filePath),
  );
  ipcMain.handle("downloads:getFolder", () => getDownloadsFolder());
  // The downloads popup's own folder-icon button (see
  // src/overlay/DownloadsPopoverContent.tsx) — opens the downloads
  // folder itself in the OS file manager, distinct from showInFolder
  // (which opens a folder with one specific FILE pre-selected).
  ipcMain.handle("downloads:openFolder", () => shell.openPath(getDownloadsFolder()));
  ipcMain.handle("downloads:pickFolder", async (e) => {
    const ctx = contextFor(e);
    const result = ctx
      ? await dialog.showOpenDialog(ctx.win, {
          properties: ["openDirectory"],
          defaultPath: getDownloadsFolder(),
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory"],
          defaultPath: getDownloadsFolder(),
        });
    if (result.canceled || !result.filePaths[0]) return getDownloadsFolder();
    setDownloadsFolder(result.filePaths[0]);
    return result.filePaths[0];
  });

  // Default browser — Windows requires the person to confirm this
  // themselves in its own Settings app for security reasons; the most
  // Electron can do is register as a candidate and then point them at that
  // page. isDefaultProtocolClient lets the UI show accurate current status.
  ipcMain.handle("system:isDefaultBrowser", () => app.isDefaultProtocolClient("https"));
  ipcMain.handle("system:setDefaultBrowser", () => {
    app.setAsDefaultProtocolClient("http");
    app.setAsDefaultProtocolClient("https");
    if (process.platform === "win32") {
      shell.openExternal("ms-settings:defaultapps").catch(() => {});
    }
  });

  // Bookmark import — Chrome/Edge only (both store bookmarks as a plain
  // JSON file at a known path); Firefox uses a SQLite database, a real
  // extra step not included here. Profiles are listed first so the person
  // can pick which one (people often have several) instead of always
  // grabbing "Default" silently.
  ipcMain.handle("import:listProfiles", (_e, browser: "chrome" | "edge") =>
    listChromiumProfiles(browser),
  );
  ipcMain.handle("import:bookmarks", (_e, browser: "chrome" | "edge", profileId: string) =>
    importChromiumBookmarks(browser, profileId),
  );

  ipcMain.handle("tools:execute", (e, name: string, args: Record<string, unknown>) => {
    const ctx = contextFor(e);
    if (!ctx) return { ok: false, text: "No window context for this call." };
    if (!BROWSER_TOOL_NAMES.has(name)) {
      return { ok: false, text: `Unknown tool: ${name}` };
    }
    return executeBrowserTool(ctx, name, args ?? {});
  });
  // Assembled fresh right before Zora's first request each turn (see
  // build-app-context.ts) — the renderer's use-zora-chat.ts calls this once
  // per send() and attaches the result as `appContext` in the request body.
  ipcMain.handle("zora:getAppContext", (e) => {
    const ctx = contextFor(e);
    return ctx ? buildAppContext(ctx) : null;
  });
  // Permission model (zora-browser-integration-plan.md section 6). Not
  // window-scoped — one person's choice of preset/overrides applies
  // across every window, same as the rest of Settings.
  ipcMain.handle("zora:getSettings", () => getZoraSettings());
  ipcMain.handle("zora:setPreset", (_e, preset: ZoraPreset) => setZoraSettings({ preset }));
  ipcMain.handle("zora:setScreenShareEnabled", (_e, enabled: boolean) => setZoraSettings({ screenShareEnabled: enabled }));
  ipcMain.handle(
    "zora:setToolPermission",
    (_e, toolName: string, mode: ToolPermissionMode | null) => setToolPermission(toolName, mode),
  );
  // Bulk-resolved (preset + overrides collapsed into one auto/ask per
  // tool) — used by both the Settings UI (to show current effective
  // state) and use-zora-chat.ts (one call per turn instead of one per
  // tool call).
  ipcMain.handle("zora:getEffectivePermissions", () => resolveAllToolPermissions(getZoraSettings()));
  ipcMain.handle("zora:getToolCatalog", () => ZORA_TOOL_CATALOG);

  ipcMain.handle("window:minimize", (e) => contextFor(e)?.win.minimize());
  ipcMain.handle("window:toggleMaximize", (e) => {
    const win = contextFor(e)?.win;
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.handle("window:close", (e) => contextFor(e)?.win.close());
  ipcMain.handle("window:isMaximized", (e) => contextFor(e)?.win.isMaximized() ?? false);
  ipcMain.handle("window:setFullScreen", (e, value: boolean) =>
    contextFor(e)?.win.setFullScreen(value),
  );
  // A direct getter alongside the enter/leave-full-screen events below —
  // the renderer uses this as a fallback (checked on window focus) in case
  // an event ever gets missed, so the tab strip can't stay stuck hidden.
  ipcMain.handle("window:isFullscreen", (e) => contextFor(e)?.win.isFullScreen() ?? false);

  // Diagnostic-only, matches the ipcRenderer.send in tab-preload.ts — prints
  // one line per tab load in the electron:dev terminal confirming the
  // tab preload actually ran.
  ipcMain.on("__qs_debug_tab_preload_loaded", (_event, url: string) => {
    console.log(`[tab-preload loaded] ${url}`);
  });
  // Diagnostic-only — matches pwDebug() in tab-preload.ts, traces autofill/
  // auto-save through each step (field found, IPC lookup result, capture
  // triggered, save result) instead of just "it doesn't work".
  ipcMain.on(
    "__qs_debug_passwords",
    (_event, report: { url: string; status: string; detail?: string }) => {
      console.log(
        `[passwords] ${report.status}${report.detail ? ` — ${report.detail}` : ""} (${report.url})`,
      );
    },
  );
}

// Fail loud in dev if a new Control Center field was ever added without a
// matching entry in control-center-field-descriptions.ts — see that file's
// doc comment. Runs once at startup, not per-request.
assertControlCenterFieldDescriptionsComplete(isDev);

app.whenReady().then(async () => {
  applyPrivacyHardening();
  await loadStoredExtensions();
  // Read BEFORE markRunning() flips the flag for this run — this is the
  // one chance to see whether the run that just ended shut down cleanly.
  crashedLastRun = !lastExitWasClean();
  markRunning();
  createWindow();
  setupAutoUpdate();
  setupPanicShortcut();
});

// --- Panic shortcut --------------------------------------------------------
// Registered globally (globalShortcut, not a per-window accelerator) —
// the whole point of a panic shortcut is that it works even if the app
// isn't currently focused, which is the more likely case in an actual
// "I need this gone right now" situation.
let currentPanicAccelerator: string | null = null;
function setupPanicShortcut() {
  const accelerator = getPrivacySettings().panicShortcut;
  if (currentPanicAccelerator) globalShortcut.unregister(currentPanicAccelerator);
  currentPanicAccelerator = null;
  if (!accelerator) return;
  const ok = globalShortcut.register(accelerator, () => {
    // destroy(), not close() — close() can be delayed or cancelled by a
    // page's own beforeunload handler, which defeats the entire point of
    // a panic shortcut needing to be instant and unconditional.
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    // No explicit "clear session data" step needed for guest/incognito/
    // Tor windows beyond this — those never write anything to disk in
    // the first place (see the guest/incognito/Tor session setup), so
    // destroying the process's in-memory state here already is the
    // clearing. A normal signed-in window's own data (bookmarks,
    // passwords, ...) is deliberately left untouched — panic is about
    // making browsing activity disappear, not about deleting someone's
    // saved account data.
    app.quit();
  });
  if (ok) currentPanicAccelerator = accelerator;
  else
    console.error(
      `[panic-shortcut] failed to register "${accelerator}" — likely already claimed by another app`,
    );
}
// Called from the IPC handler when the person changes the shortcut in
// Settings — re-registers immediately rather than needing a restart.
function updatePanicShortcut(accelerator: string) {
  setPrivacySettings({ panicShortcut: accelerator });
  setupPanicShortcut();
}

// electron-updater checks a configured publish provider (GitHub Releases
// by default, set via electron-builder's "publish" config in package.json)
// for a newer version, downloads it in the background, and — once
// downloaded — this just tells the renderer so it can show a "restart to
// update" pill in the same slot as the password-saved/session-restore
// ones (see routes/index.tsx). None of this does anything meaningful
// without two things this code can't set up on its own: a code-signing
// certificate (unsigned auto-updates trigger OS security warnings on both
// Windows and macOS) and an actual GitHub Releases publish target with
// built installers uploaded to it.
function setupAutoUpdate() {
  // autoUpdater talks to a real release feed and expects a packaged,
  // versioned build — neither is true for `npm run electron:dev`, where
  // it would just fail every check pointlessly.
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-downloaded", () => {
    for (const { win } of windows.values()) win.webContents.send("app:updateReady");
  });
  autoUpdater.on("error", (err) => {
    console.error("[auto-update] check failed:", err);
  });
  // Delayed — no reason to compete with the window's own startup work for
  // network/CPU in the first moment the app opens.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

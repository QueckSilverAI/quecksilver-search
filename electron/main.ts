import { app, BrowserWindow, ipcMain, Menu, dialog, shell } from "electron";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import net from "node:net";
import { TabManager } from "./tab-manager";
import { HOME_URL, SETTINGS_URL, type ActiveIdentity, type Bookmark, type ContentBounds, type HeaderFavorite } from "./types";
import { listBookmarks, saveBookmarks } from "./bookmark-store";
import { listHeaderFavorites, saveHeaderFavorites } from "./favorites-store";
import { getSession, logout, startLoginFlow, cancelLoginFlow } from "./auth";
import { BROWSER_TOOL_NAMES, executeBrowserTool } from "./browser-tools";
import { listDownloads, getDownloadsFolder, setDownloadsFolder, removeDownload, registerDownloadTracking } from "./downloads-store";
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
} from "./profile-store";
import { ProfileScopedStore } from "./profile-scoped-store";
import { listPasswords, addPassword, updatePassword, removePassword, importPasswords, findPasswordsForHost, autoSaveFromForm } from "./passwords-store";
import { pullProfileData, syncHeaderFavorites, syncBookmarks, syncPasswords, syncAllNow } from "./supabase-sync";
import { existsSync, rmSync } from "node:fs";

app.name = "QueckSilver Search";
// No File/Edit/View/Window/Help bar — this app is deliberately chrome-free
// beyond its own UI (see the master plan: no settings, no menu clutter).
Menu.setApplicationMenu(null);

// Bundled to CommonJS by scripts/build-electron.mjs, so __dirname is available
// natively here regardless of the app's own package.json "type": "module".
const isDev = process.env.NODE_ENV === "development";
// The chrome UI (tab strip, header, bookmark grid) is just our own React app —
// in dev it's served by `vite dev`, same as opening it in a normal browser.
const CHROME_URL = process.env.ELECTRON_START_URL ?? "http://localhost:8080";
const ICON_PATH = path.join(app.getAppPath(), "build", process.platform === "win32" ? "icon.ico" : "icon-256.png");

type WindowEntry = { win: BrowserWindow; tabs: TabManager };

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
      const timeout = setTimeout(() => reject(new Error("Production server didn't start in time")), 15000);
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
});

function createWindow(identity?: ActiveIdentity): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: "QueckSilver Search",
    icon: ICON_PATH,
    backgroundColor: "#ffffff",
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

  // The very first window is "primary" — the only one whose active
  // identity is persisted to disk and resumed on the next app launch (see
  // profile-store.ts). Any window opened afterward via "switch profile"
  // starts from an explicit identity instead (passed in below) and is
  // never itself remembered across a restart.
  if (windows.size === 0) setPrimaryWindow(win.id);
  initWindowIdentity(win.id, identity);

  const tabs = new TabManager(win);
  windows.set(win.id, { win, tabs });

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

  win.on("closed", () => {
    tabs.destroy();
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

function attachWindowListeners(win: BrowserWindow, tabs: TabManager) {
  // Surfaces preload load failures (both the chrome UI's own preload.cjs and,
  // via TabManager's onViewCreated below, each tab's tab-preload.cjs) in the
  // terminal running electron:dev — without this, a crash inside the
  // scrollbar/zoom preload script fails completely silently, and the
  // scrollbar widget just never appears with no clue why.
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
      tabs.createTab();
    } else if (key === "w") {
      event.preventDefault();
      tabs.closeActiveTab();
    } else if (key === "r") {
      event.preventDefault();
      tabs.reloadActiveTab(); // isLoading flips true, which is what actually drives the reload icon's spin animation in the renderer — no separate event needed
    } else if (key === "l") {
      event.preventDefault();
      win.webContents.send("shortcut:focusUrlBar");
    } else if (key === "d") {
      event.preventDefault();
      win.webContents.send("shortcut:addFavorite"); // favorites live in renderer state (useHeaderFavorites), same reasoning as focusing the URL bar
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
function contextFor(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): WindowEntry | null {
  const bw = BrowserWindow.fromWebContents(event.sender);
  if (!bw) return null;
  return windows.get(bw.id) ?? null;
}

function registerIpc() {
  // Pushes to Supabase only when the currently active profile (for this
  // window) is QueckSilver-linked AND has a live session — simple profiles
  // and guest mode never call this at all. Centralized here so every local
  // write (bookmarks, header favorites, passwords) triggers the matching
  // sync call the same way instead of duplicating the guard everywhere.
  function syncActiveProfileToCloud(windowId: number, fn: (session: NonNullable<ReturnType<typeof getSession>>, userId: string) => void) {
    const activeId = getActiveProfileId(windowId);
    if (!activeId) return;
    const profile = getProfile(activeId);
    if (!profile || profile.kind !== "quecksilver") return;
    const session = getSession(windowId);
    if (!session || !session.userId) return;
    fn(session, session.userId);
  }

  ipcMain.handle("tabs:new", (e, url?: string) => contextFor(e)?.tabs.createTab(url ?? HOME_URL));
  ipcMain.handle("tabs:close", (e, id: string) => contextFor(e)?.tabs.closeTab(id));
  ipcMain.handle("tabs:switch", (e, id: string) => contextFor(e)?.tabs.switchTab(id));
  ipcMain.handle("tabs:list", (e) => contextFor(e)?.tabs.listTabs());
  ipcMain.handle("tabs:reorder", (e, dragId: string, dropId: string) => contextFor(e)?.tabs.reorderTab(dragId, dropId));
  ipcMain.handle("tabs:navigate", (e, id: string, url: string) => contextFor(e)?.tabs.navigate(id, url));
  ipcMain.handle("tabs:goBack", (e, id: string) => contextFor(e)?.tabs.goBack(id));
  ipcMain.handle("tabs:goForward", (e, id: string) => contextFor(e)?.tabs.goForward(id));
  ipcMain.handle("tabs:reload", (e, id: string) => contextFor(e)?.tabs.reload(id));
  ipcMain.handle("tabs:setBounds", (e, bounds: ContentBounds) => contextFor(e)?.tabs.setContentBounds(bounds));
  ipcMain.handle("tabs:setVisible", (e, visible: boolean) => contextFor(e)?.tabs.setContentVisible(visible));
  ipcMain.handle("tabs:setDefaultZoom", (e, factor: number) => contextFor(e)?.tabs.setDefaultZoom(factor));
  ipcMain.handle("tabs:enterSplit", (e, id: string) => contextFor(e)?.tabs.enterSplit(id));
  ipcMain.handle("tabs:exitSplit", (e) => contextFor(e)?.tabs.exitSplit());
  ipcMain.handle("tabs:setSplitRatio", (e, ratio: number) => contextFor(e)?.tabs.setSplitRatio(ratio));

  ipcMain.handle("bookmarks:list", (e) => listBookmarks(contextFor(e)?.win.id ?? -1));
  ipcMain.handle("bookmarks:save", (e, bookmarks: Bookmark[]) => {
    const ctx = contextFor(e);
    if (!ctx) return;
    saveBookmarks(ctx.win.id, bookmarks);
    ctx.win.webContents.send("bookmarks:changed", bookmarks);
    syncActiveProfileToCloud(ctx.win.id, (session, userId) => syncBookmarks(session.accessToken, userId, bookmarks));
  });

  // Header bookmarks bar — separate list from the 5 home-page slots above.
  ipcMain.handle("headerFavorites:list", (e) => listHeaderFavorites(contextFor(e)?.win.id ?? -1));
  ipcMain.handle("headerFavorites:save", (e, favorites: HeaderFavorite[]) => {
    const ctx = contextFor(e);
    if (!ctx) return;
    saveHeaderFavorites(ctx.win.id, favorites);
    ctx.win.webContents.send("headerFavorites:changed", favorites);
    syncActiveProfileToCloud(ctx.win.id, (session, userId) => syncHeaderFavorites(session.accessToken, userId, favorites));
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
    createWindowForProfile(identity);
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
    if (!profile || profile.kind !== "quecksilver" || !session?.accessToken || !session.userId) return false;
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
    syncActiveProfileToCloud(ctx.win.id, (session, userId) => syncPasswords(session.accessToken, userId, listPasswords(ctx.win.id)));
    return entry;
  });
  ipcMain.handle("passwords:update", (e, id: string, url: string, username: string, password?: string) => {
    const ctx = contextFor(e);
    if (!ctx) return null;
    const entry = updatePassword(ctx.win.id, id, url, username, password);
    ctx.win.webContents.send("passwords:changed", listPasswords(ctx.win.id));
    syncActiveProfileToCloud(ctx.win.id, (session, userId) => syncPasswords(session.accessToken, userId, listPasswords(ctx.win.id)));
    return entry;
  });
  ipcMain.handle("passwords:remove", (e, id: string) => {
    const ctx = contextFor(e);
    if (!ctx) return;
    removePassword(ctx.win.id, id);
    ctx.win.webContents.send("passwords:changed", listPasswords(ctx.win.id));
    syncActiveProfileToCloud(ctx.win.id, (session, userId) => syncPasswords(session.accessToken, userId, listPasswords(ctx.win.id)));
  });
  ipcMain.handle("passwords:import", async (e, browser: "chrome" | "edge", profileId: string) => {
    const ctx = contextFor(e);
    const extracted = await importChromiumPasswords(browser, profileId);
    if (extracted.error || !ctx) return extracted;
    const result = importPasswords(ctx.win.id, extracted.entries);
    ctx.win.webContents.send("passwords:changed", listPasswords(ctx.win.id));
    syncActiveProfileToCloud(ctx.win.id, (session, userId) => syncPasswords(session.accessToken, userId, listPasswords(ctx.win.id)));
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
  ipcMain.on("passwords:rememberUsername", (_e, { host, username }: { host: string; username: string }) => {
    if (username) rememberedUsernames.set(host, username);
  });
  ipcMain.handle("passwords:getRememberedUsername", (_e, host: string) => rememberedUsernames.get(host) ?? null);
  // Called from tab-preload.ts's submit/click listener — saves silently
  // and, if it actually changed anything, tells the chrome UI to show the
  // brief "Password for X saved" pill (routes/index.tsx).
  ipcMain.handle("passwords:autoSaveFromForm", (e, { url, username, password }: { url: string; username: string; password: string }) => {
    const ctx = contextFor(e);
    console.log(`[passwords] autoSaveFromForm(url=${url}, username=${username ? "<set>" : "<empty>"}, password=${password ? "<set>" : "<empty>"})`);
    if (!ctx) return null;
    const saved = autoSaveFromForm(ctx.win.id, url, username, password);
    if (!saved) {
      console.log("[passwords] autoSaveFromForm: nothing changed (identical to an already-saved entry, or no password)");
      return null;
    }
    ctx.win.webContents.send("passwords:changed", listPasswords(ctx.win.id));
    ctx.win.webContents.send("passwords:autoSaved", { url: saved.url, username: saved.username });
    syncActiveProfileToCloud(ctx.win.id, (session, userId) => syncPasswords(session.accessToken, userId, listPasswords(ctx.win.id)));
    return saved;
  });

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
    // A brand-new profile always starts completely empty locally — if this
    // QueckSilver account already has data in the cloud (a returning user
    // on a fresh install, or a second device), pull it down now instead of
    // leaving favorites/bookmarks/passwords/settings empty until something
    // happens to trigger a push. Safe to do unconditionally here since a
    // just-created profile can't yet have any local data of its own to
    // clobber.
    if (mode === "new-profile" && session?.accessToken && session.userId) {
      const remote = await pullProfileData(session.accessToken, session.userId);
      if (remote) {
        if (Array.isArray(remote.header_favorites) && remote.header_favorites.length > 0) {
          saveHeaderFavorites(win.id, remote.header_favorites as HeaderFavorite[]);
          win.webContents.send("headerFavorites:changed", listHeaderFavorites(win.id));
        }
        if (Array.isArray(remote.bookmarks) && remote.bookmarks.length > 0) {
          saveBookmarks(win.id, remote.bookmarks as Bookmark[]);
          win.webContents.send("bookmarks:changed", listBookmarks(win.id));
        }
        if (Array.isArray(remote.passwords) && remote.passwords.length > 0) {
          importPasswords(win.id, remote.passwords as { url: string; username: string; password: string }[]);
          win.webContents.send("passwords:changed", listPasswords(win.id));
        }
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
    for (const { win } of windows.values()) win.webContents.send("downloads:changed", listDownloads());
  });
  ipcMain.handle("downloads:list", () => listDownloads());
  ipcMain.handle("downloads:remove", (_e, id: string) => {
    removeDownload(id);
    for (const { win } of windows.values()) win.webContents.send("downloads:changed", listDownloads());
  });
  ipcMain.handle("downloads:open", (_e, filePath: string) => shell.openPath(filePath));
  ipcMain.handle("downloads:showInFolder", (_e, filePath: string) => shell.showItemInFolder(filePath));
  ipcMain.handle("downloads:getFolder", () => getDownloadsFolder());
  ipcMain.handle("downloads:pickFolder", async (e) => {
    const ctx = contextFor(e);
    const result = ctx
      ? await dialog.showOpenDialog(ctx.win, { properties: ["openDirectory"], defaultPath: getDownloadsFolder() })
      : await dialog.showOpenDialog({ properties: ["openDirectory"], defaultPath: getDownloadsFolder() });
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
  ipcMain.handle("import:listProfiles", (_e, browser: "chrome" | "edge") => listChromiumProfiles(browser));
  ipcMain.handle("import:bookmarks", (_e, browser: "chrome" | "edge", profileId: string) => importChromiumBookmarks(browser, profileId));

  ipcMain.handle("tools:execute", (e, name: string, args: Record<string, unknown>) => {
    const ctx = contextFor(e);
    if (!ctx) return { ok: false, text: "No window context for this call." };
    if (!BROWSER_TOOL_NAMES.has(name)) {
      return { ok: false, text: `Unknown tool: ${name}` };
    }
    return executeBrowserTool(ctx.tabs, ctx.win, name, args ?? {});
  });

  ipcMain.handle("window:minimize", (e) => contextFor(e)?.win.minimize());
  ipcMain.handle("window:toggleMaximize", (e) => {
    const win = contextFor(e)?.win;
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.handle("window:close", (e) => contextFor(e)?.win.close());
  ipcMain.handle("window:isMaximized", (e) => contextFor(e)?.win.isMaximized() ?? false);
  ipcMain.handle("window:setFullScreen", (e, value: boolean) => contextFor(e)?.win.setFullScreen(value));
  // A direct getter alongside the enter/leave-full-screen events below —
  // the renderer uses this as a fallback (checked on window focus) in case
  // an event ever gets missed, so the tab strip can't stay stuck hidden.
  ipcMain.handle("window:isFullscreen", (e) => contextFor(e)?.win.isFullScreen() ?? false);

  // Diagnostic-only, matches the ipcRenderer.send in tab-preload.ts — prints
  // one line per tab load in the electron:dev terminal confirming the
  // scrollbar/zoom preload actually ran.
  ipcMain.on("__qs_debug_tab_preload_loaded", (_event, url: string) => {
    console.log(`[tab-preload loaded] ${url}`);
  });
  // Diagnostic-only — reports exactly why the scrollbar widget did or
  // didn't render for a page (site already styles its own, or which
  // element it attached to), matching debugReport() in tab-preload.ts.
  ipcMain.on("__qs_debug_scrollbar", (_event, report: { url: string; status: string; detail?: string }) => {
    console.log(`[scrollbar] ${report.status}${report.detail ? ` — ${report.detail}` : ""} (${report.url})`);
  });
  // Diagnostic-only — matches pwDebug() in tab-preload.ts, traces autofill/
  // auto-save through each step (field found, IPC lookup result, capture
  // triggered, save result) instead of just "it doesn't work".
  ipcMain.on("__qs_debug_passwords", (_event, report: { url: string; status: string; detail?: string }) => {
    console.log(`[passwords] ${report.status}${report.detail ? ` — ${report.detail}` : ""} (${report.url})`);
  });
}

app.whenReady().then(() => createWindow());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

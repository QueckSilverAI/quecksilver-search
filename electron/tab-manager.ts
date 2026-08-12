import { BrowserWindow, WebContentsView } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { HOME_URL, SETTINGS_URL, type ContentBounds, type TabState, type TabsSnapshot } from "./types";
import { stepZoom } from "./zoom";

// Runs at document-start in every browsed tab, injecting a small clean
// scrollbar before first paint (see tab-preload.ts) — replaces an earlier
// insertCSS()-on-dom-ready approach, which was late enough to flash
// Chromium's default scrollbar for a frame or two first.
const TAB_PRELOAD_PATH = path.join(__dirname, "tab-preload.cjs");

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
  // The current "Page zoom" setting value (Settings → Zoom) — applied to
  // every newly created tab, and to any existing tab that hasn't been
  // manually zoomed. Kept here (not just pushed out per-tab) so a freshly
  // created tab picks it up immediately instead of starting at 100% for a
  // frame.
  private defaultZoomFactor = 1;
  private viewCreatedListeners: Array<(webContents: Electron.WebContents) => void> = [];

  constructor(win: BrowserWindow) {
    this.win = win;
    this.createTab(HOME_URL);
  }

  // --- public API (called from IPC handlers in main.ts) ---------------

  listTabs(): TabsSnapshot {
    return { activeId: this.activeId, secondaryId: this.secondaryId, tabs: this.order.map((id) => this.stateFor(id)) };
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
  reloadActiveTab() {
    if (this.activeId) this.reload(this.activeId);
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
      },
    });
    view.setBounds(this.bounds);
    // Avoids a grey/transparent flash before the first paint, and keeps
    // about:blank (used internally to "go home") actually white.
    view.setBackgroundColor("#ffffff");
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
      view.webContents.loadURL(this.normalizeUrl(url)!).catch(() => {
        /* surfaced to the renderer via did-fail-load below */
      });
    }

    const emit = () => this.emitChange();
    // Without this, Electron's default behavior for target="_blank" links
    // and window.open() calls is to spawn a real, separate OS window — the
    // reported bug. Denying it and loading the URL in this same tab
    // instead matches how every normal browser actually behaves.
    view.webContents.setWindowOpenHandler(({ url }) => {
      view.webContents.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    view.webContents.on("dom-ready", () => view.setBackgroundColor("#ffffff"));
    // Ctrl+wheel scroll or a trackpad pinch — Electron detects the native
    // gesture itself and just tells us which direction; actually applying
    // it is on us, same as a real browser's per-page zoom (separate from
    // the Settings → Zoom default below).
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
        view.webContents.loadURL(notAvailablePage(validatedURL)).catch(() => {});
      }
      emit();
    });

    this.views.set(id, view);
    this.order.push(id);
    this.switchTab(id);
    return id;
  }

  closeTab(id: string) {
    const view = this.views.get(id);
    if (!view) return;

    // Detach regardless of which slot it was in — a tab being closed is
    // always currently attached (either as the sole active view or as one
    // half of a split), never just sitting inactive in the background.
    if (this.activeId === id || this.secondaryId === id) this.win.contentView.removeChildView(view);
    const wasSecondary = this.secondaryId === id;
    if (wasSecondary) this.secondaryId = null;

    view.webContents.close();
    this.views.delete(id);
    this.homeTabs.delete(id);
    this.settingsTabs.delete(id);
    this.manualZoomTabs.delete(id);
    this.order = this.order.filter((tabId) => tabId !== id);

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
  navigate(id: string, rawUrl: string) {
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

    const target = this.normalizeUrl(rawUrl);
    if (!target) return;
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

  reload(id: string) {
    this.views.get(id)?.webContents.reload();
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
      : { x: this.bounds.x + leftWidth + GAP, y: this.bounds.y, width: this.bounds.width - leftWidth - GAP, height: this.bounds.height };
  }

  // Called continuously while the person drags the divider — ratio is
  // clamped so neither side can be dragged down to nothing.
  setSplitRatio(ratio: number) {
    this.splitRatio = Math.min(0.85, Math.max(0.15, ratio));
    if (this.secondaryId) this.applySplitLayout();
  }

  private applySplitLayout() {
    if (!this.contentVisible) return;
    const leftInternal = this.activeId ? this.homeTabs.has(this.activeId) || this.settingsTabs.has(this.activeId) : true;
    const rightInternal = this.secondaryId ? this.homeTabs.has(this.secondaryId) || this.settingsTabs.has(this.secondaryId) : true;

    const leftView = this.activeId ? this.views.get(this.activeId) : null;
    const rightView = this.secondaryId ? this.views.get(this.secondaryId) : null;

    // Any OTHER attached view that isn't currently one of the two active
    // slots (e.g. a side that just navigated to home and should no longer
    // show its now-stale native content) gets detached explicitly — a
    // view lingering here would otherwise keep rendering at its last
    // bounds forever, invisible to any of this method's own bookkeeping.
    for (const [id, view] of this.views) {
      const shouldShow = (id === this.activeId && !leftInternal) || (id === this.secondaryId && !rightInternal);
      const isAttached = this.win.contentView.children.includes(view);
      if (isAttached && !shouldShow) this.win.contentView.removeChildView(view);
    }

    if (leftView && !leftInternal) {
      if (!this.win.contentView.children.includes(leftView)) this.win.contentView.addChildView(leftView);
      leftView.setBounds(this.splitBoundsFor("left"));
    }
    if (rightView && !rightInternal) {
      if (!this.win.contentView.children.includes(rightView)) this.win.contentView.addChildView(rightView);
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
      this.win.contentView.removeChildView(active);
      this.win.webContents.focus();
    }
  }

  destroy() {
    for (const view of this.views.values()) view.webContents.close();
    this.views.clear();
    this.homeTabs.clear();
    this.settingsTabs.clear();
    this.manualZoomTabs.clear();
    this.order = [];
    this.activeId = null;
    this.secondaryId = null;
  }

  // --- internals --------------------------------------------------------

  private emitChange() {
    if (this.win.isDestroyed()) return;
    this.win.webContents.send("tabs:changed", this.listTabs());
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

function notAvailablePage(attemptedUrl: string): string {
  const safeUrl = attemptedUrl.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Page not available</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh;
         margin: 0; background: #ffffff; color: #1a1a1a; }
  .box { text-align: center; max-width: 420px; padding: 24px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
  p { font-size: 14px; color: #6b6a66; margin: 0; word-break: break-all; }
</style></head>
<body><div class="box">
  <h1>This page isn't available</h1>
  <p>${safeUrl || "The page couldn't be reached."}</p>
</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

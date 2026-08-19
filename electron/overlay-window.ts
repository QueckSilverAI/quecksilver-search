// Native overlay window for dropdowns/dialogs.
//
// Replaces the old screenshot-backdrop trick (a frozen picture of the page
// shown while the tab's real native view was hidden underneath a DOM
// popup) with a real, separate BrowserWindow that can sit visually above a
// tab's native WebContentsView without that view ever having to be
// hidden. Used for the profile menu and right-click context menu
// ("belowRight"/"atPoint" placement) as well as the bookmark editor,
// new-group, and tab-search dialogs ("cover" placement — see
// OverlayAnchor's placement docs in overlay-types.ts).
//
// Deliberately ONE reusable window, not one-per-open — reused across opens
// the same way a native OS context menu is a single OS-level surface, not
// a fresh window every time. Cuts down on window-creation flicker and
// keeps only one thing to reason about for focus/blur.
import { BrowserWindow, screen, ipcMain, app } from "electron";
import path from "node:path";
import type { OverlayAction, OverlayAnchor, OverlayKind, OverlaySizeReport } from "./overlay-types";

const OVERLAY_PRELOAD_PATH = path.join(__dirname, "overlay-preload.cjs");

// Same reasoning as main.ts's CHROME_URL — dev points at the vite dev
// server, production points at the local Node server main.ts spawns
// (ensureProductionServer). The overlay route (src/routes/overlay.tsx) is
// served by that exact same server, not a separate static file — this
// project is TanStack Start SSR, not a plain multi-page Vite app, so there
// is no second index.html/rollup-entry to add here (see Phase 1 notes).
function overlayUrl(baseUrl: string): string {
  return `${baseUrl}/overlay`;
}

// Placeholder size before the overlay's own ResizeObserver reports its
// real, measured size (see Phase 2's "content measures itself" option,
// chosen over a fixed max size). Intentionally tiny + off-screen-ish so
// there's no visible flash of an empty box before the first resize.
const INITIAL_SIZE = { width: 10, height: 10 };

// Reasonable per-kind guesses for the FIRST paint of a fresh open() —
// used only as the placeholder position/size before reportSize() (the
// content's own real measured size) arrives a moment later. Picking
// something close to each popup's typical real size (rather than
// INITIAL_SIZE's tiny 10x10) keeps that follow-up resize from being a
// big, visible jump — most of these popups have a fixed width in their
// own CSS anyway (see src/overlay/*.tsx), so only the height is really a
// guess.
const INITIAL_SIZE_FOR: Partial<Record<OverlayKind, { width: number; height: number }>> = {
  profile: { width: 340, height: 420 },
  contextmenu: { width: 256, height: 260 },
  favoriteContextMenu: { width: 256, height: 300 },
  downloads: { width: 380, height: 200 },
};

// How far the panel's top edge sits below the anchor's bottom edge
// (matches ProfilePopup.tsx's existing `anchorRect.bottom + 8`).
const ANCHOR_GAP = 8;
const SCREEN_MARGIN = 12; // keep this far from the work-area edge, minimum
// Grace window after any show() during which a blur/move/resize on
// ownerWin or the overlay window itself is treated as self-inflicted
// (show() stealing OS focus) rather than a real "person clicked/alt-
// tabbed away" — see lastShowAt's doc comment below.
const RECENTLY_SHOWN_MS = 150;

// Safety net for the "wait for the real measured size before showing"
// path below (see `awaitingShowForKind`) — bounded and self-correcting,
// same philosophy as RECENTLY_SHOWN_MS: if reportSize() never arrives for
// some unforeseen reason, this fires show() anyway after a generous delay
// instead of leaving the overlay permanently stuck hidden (that failure
// mode — "popups don't show at all" — is worse than one extra guessed-size
// paint, and is exactly the regression this file's history warns about).
const AWAITING_SHOW_FALLBACK_MS = 300;

// Where the overlay window sits while logically "closed" — see close()'s
// doc comment for why this replaced win.hide(). Far enough outside any
// realistic monitor arrangement to never overlap a real display.
const OFFSCREEN_X = -32000;
const OFFSCREEN_Y = -32000;

// TEMPORARY DIAGNOSTIC TOGGLE — confirmed the flash's cause (native
// Windows/DWM compositing of a transparent, alwaysOnTop, parented window
// on every hidden->shown transition — see show()'s doc comment for the
// actual fix that's now in place). Leave this false; only flip to true
// again if a future report needs re-confirming that theory.
const DIAGNOSTIC_DISABLE_TRANSPARENCY = false;

// TEMPORARY diagnostic logging — traces every show()/hide()/close() and
// the reasoning behind each one, with the delta in ms since the previous
// log line, so a reported double-flash can be matched up against the
// exact sequence of native events that produced it instead of guessing.
// Remove once the double-flash / stale-content-flash reports are
// resolved and confirmed fixed.
let lastOverlayLogAt = Date.now();
function overlayLog(msg: string) {
  const now = Date.now();
  const delta = now - lastOverlayLogAt;
  lastOverlayLogAt = now;
  console.log(`[overlay] +${delta}ms ${msg}`);
}

export class OverlayWindowManager {
  private overlayWin: BrowserWindow | null = null;
  private ownerWin: BrowserWindow | null = null;
  private currentKind: OverlayKind | null = null;
  private currentAnchor: OverlayAnchor | null = null;
  private pendingPayload: unknown = null;
  private loaded = false;
  // The real (measured, via reportSize) size the window last settled at
  // for each kind, remembered across close()/reopen — NOT reset by close()
  // the way currentKind is. Used instead of INITIAL_SIZE_FOR's coarse
  // per-kind guess whenever we already know better, so a repeat open of a
  // kind that's already been measured this session opens directly at its
  // real size instead of a placeholder that's then visibly corrected a
  // moment later (the "double flash" on reopen — see reportSize below).
  private lastMeasuredSize: Partial<Record<OverlayKind, { width: number; height: number }>> = {};
  // Which kind the renderer has actually rendered AND measured, i.e. what
  // the DOM currently shows for real — set in reportSize(), which only
  // fires once the renderer has processed an "overlay:init" and painted
  // it. NOT the same thing as `opened`/wasVisible: those describe whether
  // the window happens to be revealed RIGHT NOW, but the DOM content
  // persists regardless of that (this window is reused, never remounted
  // — see the class comment), so "currently closed" does NOT mean "safe
  // to reveal immediately" — the stale previous kind is still what's
  // sitting there until reportSize() confirms otherwise. This is what
  // open() actually needs to decide whether to defer a reveal, not
  // wasVisible (see its own doc comment for the race that exposed this:
  // a real-world blur — e.g. right-clicking a tab while the profile
  // popup is open — can close() the window, via its own blur handler,
  // BEFORE the resulting open() for the new kind ever runs, making
  // wasVisible false while the DOM still shows the old kind).
  private lastRenderedKind: OverlayKind | null = null;
  // Set while we've hidden the window for a kind switch (see open()) and
  // are holding off on showing it again until the NEW kind's real content
  // has actually rendered and reported its size — otherwise show() would
  // make the window visible again immediately with the OLD kind's stale
  // content still on screen (flushPending()'s IPC send is async; the
  // renderer hasn't necessarily processed it yet by the time show() would
  // run). Cleared by show() itself, by reportSize() once it acts on it, or
  // by the fallback timer below.
  private awaitingShowForKind: OverlayKind | null = null;
  private awaitingShowFallback: NodeJS.Timeout | null = null;
  // Our OWN logical open/closed state — the source of truth everywhere in
  // this class that used to call `overlayWin.isVisible()`. Needed because
  // show()/close() no longer call win.show()/win.hide() at all (see
  // close()'s doc comment for why), so the native isVisible() would just
  // report "true" forever after the first reveal and stop meaning
  // anything.
  private opened = false;
  // Whether the native window has EVER been through Electron's real
  // show() at least once — see primeNativeMapping()'s doc comment.
  private everMapped = false;
  // Set to Date.now() every time show() actually runs — see the blur/
  // move/resize guards below. show() itself steals OS focus away from
  // ownerWin, which fires ownerWin's own "blur" a moment later —
  // completely unrelated to the person actually clicking away, but
  // indistinguishable from it to a naive blur handler. A short
  // time-based grace window after any show() is simpler and more
  // self-correcting than a manually toggled "are we mid-transition"
  // flag (which, if a reset path is ever missed, can get stuck true
  // forever and silently swallow every future close) — this can never
  // get stuck, since it decays on its own.
  private lastShowAt = 0;
  private baseUrlPromise: Promise<string>;
  // Registered once per manager instance (one per top-level app window —
  // see main.ts), not once globally, so the emitted action always goes
  // back to the window that actually opened the overlay.
  private onAction: (action: OverlayAction) => void;
  // Shared across every OverlayWindowManager instance (one per top-level
  // app window) — lets registerOverlayIpc's single, module-level IPC
  // handlers below resolve "which manager does this overlay BrowserWindow
  // belong to" purely from the overlay window's own id, without main.ts
  // having to wire that up itself. Populated/cleaned up entirely inside
  // ensureWindow/the window's "closed" listener.
  private registry: Map<number, OverlayWindowManager>;

  constructor(ownerWin: BrowserWindow, getBaseUrl: () => Promise<string>, onAction: (action: OverlayAction) => void, registry: Map<number, OverlayWindowManager>) {
    this.ownerWin = ownerWin;
    this.baseUrlPromise = getBaseUrl();
    this.onAction = onAction;
    this.registry = registry;



    // Owner window losing focus, moving, resizing, or minimizing should
    // always close whatever overlay it opened — EXCEPT a "cover" overlay
    // (a real modal dialog), which should track the owner window's
    // move/resize instead of closing, and should NOT auto-close on blur
    // (alt-tabbing away shouldn't dismiss an open dialog) — matches how a
    // real modal behaves elsewhere. See positionNear's placement branch.
    ownerWin.on("move", () => this.trackOwnerOrClose());
    ownerWin.on("resize", () => this.trackOwnerOrClose());
    ownerWin.on("blur", () => {
      const sinceShow = Date.now() - this.lastShowAt;
      overlayLog(`ownerWin blur (sinceShow=${sinceShow}ms, overlayVisible=${this.overlayWin?.isVisible()}, overlayFocused=${this.overlayWin?.isFocused()}, awaitingShow=${this.awaitingShowForKind})`);
      if (sinceShow < RECENTLY_SHOWN_MS) return overlayLog("  -> ignored (within RECENTLY_SHOWN_MS grace)");
      if (this.currentAnchor?.placement === "cover") return overlayLog("  -> ignored (cover placement)");
      if (this.overlayWin && !this.overlayWin.isDestroyed() && this.overlayWin.isFocused()) return overlayLog("  -> ignored (overlay itself is focused)");
      // Mid kind-switch, waiting on the new content's real size before
      // showing again (see open()'s `deferShow` / `awaitingShowForKind`)
      // — the window itself is briefly hidden and unfocused as an
      // expected part of that, not because anyone clicked away. A blur
      // landing in this window is essentially always that, not a real
      // dismiss; ignore it and let reportSize()'s upcoming show() (or its
      // fallback timer) run as planned.
      if (this.awaitingShowForKind) return overlayLog("  -> ignored (awaiting deferred show)");
      overlayLog("  -> CLOSING (ownerWin blur, no guard matched)");
      this.close();
    });
    ownerWin.on("minimize", () => {
      if (Date.now() - this.lastShowAt < RECENTLY_SHOWN_MS) return;
      this.close();
    });
    ownerWin.on("closed", () => {
      this.ownerWin = null;
      this.destroy();
    });
  }

  private ensureWindow(): BrowserWindow {
    if (this.overlayWin && !this.overlayWin.isDestroyed()) return this.overlayWin;

    const win = new BrowserWindow({
      width: INITIAL_SIZE.width,
      height: INITIAL_SIZE.height,
      show: false,
      frame: false,
      transparent: !DIAGNOSTIC_DISABLE_TRANSPARENCY,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      parent: this.ownerWin ?? undefined,
      backgroundColor: DIAGNOSTIC_DISABLE_TRANSPARENCY ? "#ffffff" : "#00000000",
      webPreferences: {
        preload: OVERLAY_PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Windows/Linux only — matches how the "vibrancy"/shadow story already
    // differs per platform elsewhere in this app (see createWindow's own
    // titleBarStyle/frame split in main.ts). alwaysOnTop's "floating"
    // level keeps this above the parent's own always-on-top-eligible
    // content without fighting the OS window manager on Linux compositors
    // that don't support true per-window alpha (flagged as a Phase 6 risk
    // in the plan — nothing to fix here, just where it'll surface).
    if (process.platform === "darwin") {
      win.setAlwaysOnTop(true, "floating");
    }

    // Losing OS focus (click outside, Alt-Tab away, ...) closes the
    // overlay. Same self-inflicted-focus-steal risk as ownerWin's own
    // blur handler above — see lastShowAt's doc comment.
    win.on("blur", () => {
      const sinceShow = Date.now() - this.lastShowAt;
      overlayLog(`overlayWin blur (sinceShow=${sinceShow}ms, awaitingShow=${this.awaitingShowForKind}, visible=${win.isVisible()})`);
      if (sinceShow < RECENTLY_SHOWN_MS) return overlayLog("  -> ignored (within RECENTLY_SHOWN_MS grace)");
      // Same reasoning as ownerWin's own blur handler above — a blur on
      // this window while we're deliberately sitting hidden mid
      // kind-switch (e.g. triggered by the hide() call itself) isn't a
      // real "click away", it's expected. Don't let it cancel the
      // upcoming show().
      if (this.awaitingShowForKind) return overlayLog("  -> ignored (awaiting deferred show)");
      overlayLog("  -> CLOSING (overlayWin blur, no guard matched)");
      this.close();
    });

    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") this.close();
    });

    win.on("closed", () => {
      this.registry.delete(win.id);
      if (this.overlayWin === win) {
        this.overlayWin = null;
        this.loaded = false;
      }
    });

    win.webContents.once("did-finish-load", () => {
      this.loaded = true;
      // Do the ONE real native show() this window will ever get (see
      // primeNativeMapping()'s doc comment) here, off-screen, regardless
      // of whether a popup has actually been requested yet — so that if
      // warmUp() (called from main.ts right after this manager is
      // constructed, well before the person can have clicked anything
      // yet) got here first, priming is already done for free and the
      // person's actual first popup is a plain opacity/focus reveal like
      // every other one, no different one-time cost. If nothing called
      // warmUp() first for some reason, this still primes it now, before
      // whatever content the FIRST real open() call queued — meaning the
      // very first popup's own reveal is at least never resizing/
      // repositioning WHILE doing its one-time native show(), even if it
      // can't avoid the show() itself happening for the first time right
      // then.
      this.primeNativeMapping();
      this.flushPending();
      // First-ever load of this window — nothing was ever shown before
      // now, so there's no "hide the stale previous content" concern.
      // There IS still a "don't have real content yet" concern though:
      // flushPending()'s IPC send is async, so revealing immediately here
      // would do so before React has even mounted anything — visible as
      // a blank/grey box at the placeholder size for a moment before the
      // real content and its real measured size land (the very first
      // popup a person opens each app launch, since this only runs once
      // per window). presentAfterFlush(true) below handles that the same
      // way it handles a kind switch — forced, since there's no
      // `lastMeasuredSize` guess to fall back on yet either way. No-ops
      // harmlessly if warmUp() (not a real popup) is what triggered this
      // load — see its own doc comment.
      this.presentAfterFlush(true);
    });

    this.overlayWin = win;
    this.registry.set(win.id, this);
    void this.baseUrlPromise.then((base) => win.loadURL(overlayUrl(base)));
    return win;
  }

  // Call as soon as possible after construction (main.ts does, right after
  // creating this manager) — kicks off loadURL()/did-finish-load and the
  // one-time native show() (see primeNativeMapping()) well before the
  // person has had a chance to open any real popup, so by the time they
  // do, the window's DWM-composited transparent surface already exists
  // and revealing it is just an opacity/focus change (cheap, no native
  // show() involved — see show()'s doc comment for why that matters).
  // Safe to call multiple times or not at all — ensureWindow() and
  // primeNativeMapping() are both idempotent.
  warmUp() {
    this.ensureWindow();
  }

  // The layered/transparent-window flash this file used to fight (see
  // show()'s and close()'s doc comments) turned out to only happen on an
  // actual hidden->shown native transition — Electron's show()/hide().
  // Toggling opacity on an ALREADY-shown window doesn't need Windows/DWM
  // to reestablish that window's composited surface, so it doesn't
  // flash. That means the native show() still has to happen at some
  // point — just once, ever, per window instance — and this is that one
  // call. Doing it off-screen (see OFFSCREEN_X/Y) means even if IT still
  // has some native first-show hiccup, nobody's there to see it.
  private primeNativeMapping() {
    if (this.everMapped || !this.overlayWin || this.overlayWin.isDestroyed()) return;
    this.overlayWin.setOpacity(0);
    this.overlayWin.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
    this.overlayWin.showInactive();
    this.everMapped = true;
  }

  private flushPending() {
    if (!this.overlayWin || !this.loaded || !this.currentKind) return;
    this.overlayWin.webContents.send("overlay:init", { kind: this.currentKind, payload: this.pendingPayload });
  }

  private show() {
    if (!this.overlayWin || this.overlayWin.isDestroyed()) return;
    overlayLog(`show() kind=${this.currentKind} (nativeVisible=${this.overlayWin.isVisible()}, opened=${this.opened})`);
    this.clearAwaitingShow();
    // Splitting "become visible" from "take OS focus" into two calls
    // (showInactive()+focus() instead of plain show()) turned out NOT to
    // be enough on its own to avoid the reported flash — confirmed by a
    // test build with transparency disabled entirely (flash gone) and
    // then one with just that split (flash still there). The actual fix:
    // never call Electron's show()/hide() again after the very first
    // time (see primeNativeMapping()) — every reveal after that is just
    // becoming opaque + focused at the position/size positionNear()
    // already set, and every close() is just becoming transparent +
    // moved off-screen (see its own doc comment). Windows/DWM only needs
    // to reestablish a transparent window's composited surface on an
    // actual hidden->shown native transition; toggling opacity on a
    // window that's already natively "shown" doesn't touch that surface,
    // so there's nothing left to flash.
    this.primeNativeMapping(); // no-op if already primed — safety net, see warmUp()
    this.overlayWin.setOpacity(1);
    this.overlayWin.focus();
    this.opened = true;
    this.lastShowAt = Date.now();
  }

  private clearAwaitingShow() {
    this.awaitingShowForKind = null;
    if (this.awaitingShowFallback) {
      clearTimeout(this.awaitingShowFallback);
      this.awaitingShowFallback = null;
    }
  }

  // Shared by open() (kind switch while something else is visible) and
  // ensureWindow's did-finish-load (the very first show of this window) —
  // both pass forceDefer=true. Deliberately NOT triggered by "we've never
  // measured this kind before" anymore (an earlier version of this also
  // deferred whenever `!hasKnownSize`, to avoid showing at a guessed size
  // that reportSize() would shortly correct) — that traded one small
  // problem for a bigger one: reportSize() can take a few hundred ms to
  // round-trip in practice (renderer paint + IPC), so that version left
  // the very first open of every kind sitting fully invisible for up to
  // AWAITING_SHOW_FALLBACK_MS, which read as a stall rather than a flash.
  // A guessed-then-corrected size is the lesser evil there, especially
  // now that reportSize() only resizes when the size actually changed
  // (see reportSize below) — so a correct guess (the common case once a
  // kind has been opened once this session) never touches the window at
  // all, and only a wrong first-ever guess pays for one resize.
  private presentAfterFlush(forceDefer = false) {
    const kind = this.currentKind;
    const anchor = this.currentAnchor;
    if (!kind || !anchor) {
      this.show();
      return;
    }
    const deferShow = forceDefer && anchor.placement !== "cover";
    overlayLog(`presentAfterFlush() kind=${kind} forceDefer=${forceDefer} -> deferShow=${deferShow}`);
    if (!deferShow) {
      this.show();
      return;
    }
    this.awaitingShowForKind = kind;
    this.awaitingShowFallback = setTimeout(() => {
      this.awaitingShowFallback = null;
      overlayLog(`awaitingShow fallback timer fired for kind=${kind} (still awaiting=${this.awaitingShowForKind === kind && this.currentKind === kind})`);
      if (this.awaitingShowForKind === kind && this.currentKind === kind) this.show();
    }, AWAITING_SHOW_FALLBACK_MS);
  }

  // NOT a general "wait for a ready/size signal from the renderer before
  // showing" coordination scheme — that kind of coordination has
  // repeatedly turned out to be fragile in ways that only show up under
  // real usage, and "doesn't show at all" is a far worse failure than
  // "shows at a placeholder size for a moment". presentAfterFlush() only
  // waits in the specific cases where showing immediately is strictly
  // worse than waiting a moment (switching kind while something else is
  // visible, or a kind whose real size has never been measured this
  // session — see its own doc comment) — and even then it's bounded by
  // AWAITING_SHOW_FALLBACK_MS, so it can't get permanently stuck the way
  // a flag-based "are we ready" scheme could. Every other case shows
  // immediately, same as before.
  open(kind: OverlayKind, payload: unknown, anchor: OverlayAnchor) {
    const win = this.ensureWindow();
    const switchingKind = kind !== this.currentKind;
    const wasVisible = this.opened;
    overlayLog(`open() kind=${kind} (prevKind=${this.currentKind}, switchingKind=${switchingKind}, wasVisible=${wasVisible}, loaded=${this.loaded})`);
    // Any previous "wait for the new kind's real size" wait is moot the
    // instant a fresh open() comes in — either this open() will set up
    // its own (for a different kind again) or it won't need one at all.
    this.clearAwaitingShow();

    this.currentKind = kind;
    this.currentAnchor = anchor;
    this.pendingPayload = payload;

    // Whether the DOM already shows this exact kind for real, per
    // lastRenderedKind's doc comment — NOT the same question as
    // "wasVisible"/switchingKind, which only describe the window's
    // current opacity/position, not what's actually painted inside it
    // (this window is reused, never remounted, so old content persists
    // regardless of whether it happens to be revealed right now).
    const contentReady = kind === this.lastRenderedKind;
    const forceDeferShow = !contentReady;
    // If something's currently revealed and it's NOT already the right
    // content, retreat it off-screen now instead of leaving the stale
    // kind showing while we wait for the new one to render — otherwise
    // it'd just sit there, visible, until presentAfterFlush()'s eventual
    // show() call swaps it out, i.e. exactly the "previous popup
    // flashes" symptom. Skipped when contentReady (nothing stale to
    // hide) or when nothing was visible to begin with (nothing to hide).
    if (wasVisible && forceDeferShow) {
      overlayLog(`open() retreating window off-screen (kind switch to ${kind} while visible)`);
      this.retreatOffscreen();
    }

    if (switchingKind || !wasVisible) {
      // Prefer the real size this kind measured at last time it was open
      // (remembered across close()/reopen, unlike currentKind) over the
      // coarse per-kind guess — opening directly at the known-correct
      // size avoids the placeholder-then-correct visible resize that
      // guessing produces on every single reopen (see lastMeasuredSize's
      // doc comment). Falls back to the guess (then the tiny default) the
      // first time a kind is ever opened this session, when nothing's
      // been measured yet.
      const guess = this.lastMeasuredSize[kind] ?? INITIAL_SIZE_FOR[kind] ?? INITIAL_SIZE;
      this.positionNear(anchor, guess.width, guess.height);
    } else {
      // Same kind, already visible — reposition at the CURRENT known
      // size (e.g. the anchor moved slightly), not the placeholder guess.
      const bounds = win.getBounds();
      this.positionNear(anchor, bounds.width, bounds.height);
    }

    if (this.loaded) {
      this.flushPending();
      this.presentAfterFlush(forceDeferShow);
    }
    // else: did-finish-load (registered in ensureWindow) flushes AND
    // shows (via presentAfterFlush) once the page has actually loaded for
    // the first time.
  }

  // Refreshes the payload of whichever overlay is CURRENTLY open, without
  // repositioning/refocusing it — used when the data an already-open
  // overlay is showing changes underneath it (e.g. the profiles list
  // changes while the profile popup happens to be open). No-ops if this
  // "kind" isn't the one currently open, or nothing is open at all.
  update(kind: OverlayKind, payload: unknown) {
    if (!this.overlayWin || this.currentKind !== kind || !this.opened) return;
    this.pendingPayload = payload;
    this.flushPending();
  }

  private trackOwnerOrClose() {
    // Same self-inflicted-event problem as the ownerWin "blur" handler
    // above — showing/hiding/resizing a CHILD window (this overlay is
    // `parent: ownerWin`) can itself trigger a synthetic "move"/"resize"
    // notification on the OWNER
    // window on some platforms, completely unrelated to the person
    // actually moving/resizing the app window. Without this guard, that
    // closed the just-opened overlay the same way the blur race did.
    const sinceShow = Date.now() - this.lastShowAt;
    overlayLog(`trackOwnerOrClose() (sinceShow=${sinceShow}ms)`);
    if (sinceShow < 150) return overlayLog("  -> ignored (within grace)");
    if (this.currentAnchor?.placement === "cover" && this.overlayWin && this.currentKind) {
      overlayLog("  -> repositioning (cover)");
      this.positionNear(this.currentAnchor, 0, 0);
      return;
    }
    overlayLog("  -> CLOSING (owner move/resize, no guard matched)");
    this.close();
  }

  // Called after the overlay renderer's own ResizeObserver measures its
  // real content and reports it back over IPC (registered in
  // registerOverlayIpc below) — see Phase 2, "content measures itself".
  reportSize(size: OverlaySizeReport) {
    overlayLog(`reportSize() kind=${this.currentKind} size=${Math.round(size.width)}x${Math.round(size.height)}`);
    if (this.currentAnchor?.placement === "cover") return; // cover mode is sized to the owner window directly, not measured content
    if (!this.overlayWin || !this.currentAnchor || !this.currentKind) return;
    // Defensive cap — whatever the content's own CSS (max-height +
    // overflow-y-auto, e.g. the downloads flyout's scrollable list) is
    // SUPPOSED to constrain it to, nothing here previously stopped this
    // window from growing to match a measured size of ANY height if that
    // CSS-level cap somehow didn't hold (a person reported exactly that:
    // a long downloads list just kept growing the window instead of
    // scrolling, no visible scrollbar at all). 85% of the screen's own
    // work area is generous enough to never visibly clip anything that
    // actually IS correctly capped by its own CSS, while guaranteeing
    // this window itself can never grow past a sane, always-on-screen
    // size regardless of what content measurement comes in.
    const display = screen.getDisplayMatching(this.overlayWin.getBounds());
    const maxHeight = Math.floor(display.workArea.height * 0.85);
    const height = Math.min(Math.ceil(size.height), maxHeight);
    // positionNear() already applies the final x/y/width/height in one
    // setBounds() call — there used to be a SECOND setBounds() right
    // here afterwards (wrapped in a setResizable(true)/setResizable(false)
    // toggle that turned out to be unnecessary: setBounds() works fine on
    // a non-resizable window, that property only governs whether a person
    // can drag the window's own edges), reapplying the exact same
    // width/height a second time. Two back-to-back native resizes (with a
    // resizable-flag toggle in between, which some window managers treat
    // as needing to re-map the window) is almost certainly what the
    // reported "double flash" actually was — it happened on every single
    // reportSize() call, for every non-cover popup, regardless of
    // whether the measured size differed from what was already showing.
    // One resize call here now, matching what positionNear() already does
    // for the "cover" branch (a single setBounds(), no toggle).
    //
    // AND skip that one call entirely if it would be a no-op. This
    // matters a lot more than it sounds like it should: reportSize() runs
    // AFTER show() in the common case (the window is already visible by
    // the time the renderer's ResizeObserver gets around to reporting —
    // see the diagnostic log this replaced), and calling setBounds() on
    // an already-visible, transparent, alwaysOnTop, parented window is
    // exactly the combination Windows/DWM is known to occasionally
    // repaint badly for, producing a visible blink even when the bounds
    // being set are IDENTICAL to the current ones. ResizeObserver always
    // fires once for every open() (ResizeObserver's initial observation
    // always delivers an entry, whether or not the size actually
    // changed), so without this check every single open() of an
    // already-measured kind was resizing a visible window for no reason
    // — which lines up with the double-flash being reported on every
    // reopen even after lastMeasuredSize made the initial guess correct.
    const currentBounds = this.overlayWin.getBounds();
    const roundedWidth = Math.round(size.width);
    if (roundedWidth === currentBounds.width && height === currentBounds.height) {
      overlayLog("reportSize(): size unchanged, skipping setBounds (avoids resizing a visible window for nothing)");
    } else {
      this.positionNear(this.currentAnchor, size.width, height);
    }

    // Remember this as the real size for THIS kind, so the next time it's
    // opened (even after a full close(), which resets currentKind but not
    // this) open() can position it correctly up front instead of guessing
    // — see lastMeasuredSize's doc comment. Rounded the same way
    // positionNear() itself rounds width/height right before its own
    // setBounds() call, so this matches what the window's bounds were
    // ACTUALLY just set to (Math.ceil could disagree with positionNear's
    // Math.round by a pixel, which would then look "different" on the
    // next open() and trigger a needless extra resize for no visible
    // reason).
    this.lastMeasuredSize[this.currentKind] = { width: Math.round(size.width), height: Math.round(height) };

    // The renderer has now actually rendered AND measured this kind —
    // see lastRenderedKind's doc comment. This is the signal open() uses
    // to decide whether a reveal is safe to do immediately or needs to
    // wait, so it has to be set unconditionally here, even on the
    // "size unchanged, skip setBounds" fast path above.
    this.lastRenderedKind = this.currentKind;

    // If open() hid the window for a kind switch and is waiting for the
    // new kind's real, rendered content to be measured before showing it
    // again (see `awaitingShowForKind`'s doc comment) — this IS that
    // signal: the renderer has now actually rendered the new kind and
    // measured it, so it's safe to show without any stale content
    // flashing first.
    if (this.awaitingShowForKind === this.currentKind) this.show();
  }

  // Converts a window-relative anchor rect (DOMRect shape, same as today's
  // ProfilePopup anchorRect) into an absolute on-screen position for the
  // overlay window, accounting for the owner window's own frame/chrome and
  // for which monitor's work area it should stay inside (Phase 2's
  // multi-monitor requirement).
  private positionNear(anchor: OverlayAnchor, width: number, height: number) {
    if (!this.overlayWin || !this.ownerWin || this.ownerWin.isDestroyed()) return;

    const contentBounds = this.ownerWin.getContentBounds();

    if (anchor.placement === "cover") {
      // Ignores width/height entirely — covers the owner window's full
      // content area exactly (same viewport a Radix Dialog's own
      // `fixed inset-0` backdrop would cover), not something measured
      // from content (see reportSize's early-return for "cover").
      this.overlayWin.setBounds({ x: contentBounds.x, y: contentBounds.y, width: contentBounds.width, height: contentBounds.height });
      return;
    }

    // getContentBounds() is already in absolute screen coordinates and
    // already excludes the window frame/titlebar — window-relative
    // anchor coordinates (from getBoundingClientRect() in the chrome UI's
    // own webContents) map directly onto it with no extra offset needed,
    // UNLIKE ownerBounds (which still includes the frame and would be
    // wrong on platforms with a visible native frame, e.g. Windows).
    const placement = anchor.placement ?? "belowRight";
    const absLeft = placement === "atPoint" ? contentBounds.x + anchor.left : contentBounds.x + anchor.right - width;
    const absTop = placement === "atPoint" ? contentBounds.y + anchor.top : contentBounds.y + anchor.bottom + ANCHOR_GAP;

    const display = screen.getDisplayMatching({
      x: contentBounds.x + Math.round((anchor.left + anchor.right) / 2) - 1,
      y: contentBounds.y + Math.round((anchor.top + anchor.bottom) / 2) - 1,
      width: 2,
      height: 2,
    });
    const wa = display.workArea;

    let x = absLeft;
    let y = absTop;

    // Flip left if the panel would run off the right edge of the work
    // area, matching ProfilePopup.tsx's existing
    // `Math.max(12, window.innerWidth - anchorRect.right)` right-edge
    // clamp, just done in screen space now instead of CSS.
    if (x + width > wa.x + wa.width - SCREEN_MARGIN) x = wa.x + wa.width - SCREEN_MARGIN - width;
    if (x < wa.x + SCREEN_MARGIN) x = wa.x + SCREEN_MARGIN;

    // Flip upward (open above the anchor instead of below) if there isn't
    // enough room underneath in this display's work area — the "Umkehr-
    // Logik" called out in Phase 2.
    if (y + height > wa.y + wa.height - SCREEN_MARGIN) {
      const above = contentBounds.y + anchor.top - ANCHOR_GAP - height;
      y = above >= wa.y + SCREEN_MARGIN ? above : wa.y + SCREEN_MARGIN;
    }

    this.overlayWin.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  }

  // Used by main.ts's "overlay:frequentSites" handler — the overlay
  // BrowserWindow's own id isn't a key in the `windows` Map (only owner/
  // top-level app windows are, see createWindow), so resolving "which
  // owner window's frequent-sites data should this overlay's URL field
  // autocomplete against" has to go through the manager instead.
  get ownerWindowId(): number | null {
    return this.ownerWin && !this.ownerWin.isDestroyed() ? this.ownerWin.id : null;
  }

  sendAction(action: OverlayAction) {
    this.onAction(action);
    this.close();
  }

  // Same as sendAction, minus the close() — for actions that shouldn't
  // dismiss the popup (e.g. the profile popup's "sync now": a person
  // reported clicking it closed the menu, which they didn't want — sync
  // is something you'd naturally want to watch complete without the menu
  // vanishing out from under you).
  notifyAction(action: OverlayAction) {
    this.onAction(action);
  }

  close() {
    const caller = new Error().stack?.split("\n")[2]?.trim() ?? "?";
    overlayLog(`close() (opened=${this.opened}) called from: ${caller}`);
    this.clearAwaitingShow();
    if (!this.opened) return overlayLog("  -> no-op (already closed)");
    this.retreatOffscreen();
    this.currentKind = null;
    this.currentAnchor = null;
    this.pendingPayload = null;
  }

  // Replaces the old win.hide() — see show()'s doc comment for why: a
  // real Electron hide() (and the show() that would eventually undo it)
  // is what triggers Windows/DWM to redo this window's transparent
  // compositing surface, which is what the reported flash actually was.
  // Going transparent + moving off-screen instead means the window stays
  // natively "shown" the whole time (after its one-time real show() in
  // primeNativeMapping()), so there's no surface to reestablish later.
  // Opacity 0 alone isn't enough on its own — an invisible-but-still-
  // onscreen, alwaysOnTop, click-through-by-default window would still
  // intercept clicks meant for whatever's underneath it — so both.
  // Also hands focus back to the owner window, since making a window
  // transparent/relocated doesn't relinquish OS focus by itself, and
  // this window would otherwise keep silently eating Escape presses and
  // keystrokes meant for the real page while "closed".
  private retreatOffscreen() {
    if (!this.overlayWin || this.overlayWin.isDestroyed()) return;
    this.opened = false;
    this.overlayWin.setOpacity(0);
    this.overlayWin.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
    if (this.ownerWin && !this.ownerWin.isDestroyed()) this.ownerWin.focus();
  }

  destroy() {
    this.clearAwaitingShow();
    if (this.overlayWin && !this.overlayWin.isDestroyed()) this.overlayWin.destroy();
    this.overlayWin = null;
  }
}

// Registered exactly once, globally (like the rest of main.ts's
// registerIpc — see createWindow's ipcRegistered guard) — resolves which
// owner window's OverlayWindowManager an overlay action belongs to via the
// overlay BrowserWindow's own id, since the overlay window itself is what
// event.sender resolves to here, not the owner. Call this once at startup
// with a single shared Map; each OverlayWindowManager instance populates
// its own entries into it as overlay windows are created/closed.
export function registerOverlayIpc(registry: Map<number, OverlayWindowManager>) {
  ipcMain.on("overlay:action", (event, action: OverlayAction) => {
    const bw = BrowserWindow.fromWebContents(event.sender);
    if (!bw) return;
    registry.get(bw.id)?.sendAction(action);
  });
  ipcMain.on("overlay:notify", (event, action: OverlayAction) => {
    const bw = BrowserWindow.fromWebContents(event.sender);
    if (!bw) return;
    registry.get(bw.id)?.notifyAction(action);
  });
  ipcMain.on("overlay:reportSize", (event, size: OverlaySizeReport) => {
    const bw = BrowserWindow.fromWebContents(event.sender);
    if (!bw) return;
    registry.get(bw.id)?.reportSize(size);
  });
  ipcMain.on("overlay:requestClose", (event) => {
    const bw = BrowserWindow.fromWebContents(event.sender);
    if (!bw) return;
    registry.get(bw.id)?.close();
  });
  app.on("before-quit", () => {
    for (const manager of new Set(registry.values())) manager.destroy();
  });
}

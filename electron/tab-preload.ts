// Dedicated preload for every browsed tab (not the chrome UI's own preload).
//
// Two independent jobs, both scoped to this one tab's page:
//  1. Hide Chromium's native page scrollbar immediately (document-start,
//     before first paint — no flash of the default chunky one) and, once
//     the page has actually loaded, replace it with our own widget (same
//     track/thumb/arrow design as the chat history sidebar), for any page
//     that actually scrolls the document itself (not just an internal div
//     — that path is still respected, see findScrollTarget below).
//
//     Always replaces the page's own scrollbar, even ones the page styled
//     itself (e.g. YouTube's ::-webkit-scrollbar-thumb tweak) — deliberate:
//     a ::-webkit-scrollbar-* rule only ever re-skins the native Chromium
//     scrollbar in Chromium-based browsers. It's not a real cross-browser
//     design (Firefox ignores it entirely and shows its own native one via
//     scrollbar-color instead, which almost no site sets alongside it), so
//     respecting it bought inconsistency, not respect for a deliberate
//     design.
import { ipcRenderer, webFrame } from "electron";

// Diagnostic-only: confirms in the electron:dev terminal that this preload
// actually loaded and ran for this tab. If the scrollbar is missing and
// this line never shows up in the terminal, tab-preload.cjs isn't being
// injected at all (build/path/wait-on issue) rather than the scrollbar
// logic itself failing — narrows the search immediately instead of
// guessing. Safe to leave in; it's one ipcRenderer.send per tab load.
//
// Main-frame-only — nodeIntegrationInSubFrames (tab-manager.ts) now also
// injects this same script into every <iframe> on the page (needed so
// password autofill/autosave can reach a login form embedded in one, e.g.
// Wix's sign-in widget), and logging this once per random ad/embed iframe
// on every page would drown out anything useful. Autofill logic further
// below deliberately does NOT have this guard — it's meant to run in
// every frame.
if (process.isMainFrame) {
  ipcRenderer.send("__qs_debug_tab_preload_loaded", location.href);

  // Hides the top-level document's own scrollbar on both html and body
  // (some sites, e.g. YouTube, style body::-webkit-scrollbar rather than
  // html's even though html is the actual scrolling element in standards
  // mode — harmless to hide both), so any internal scroll container the page
  // manages itself (a chat panel, a code viewer, ...) keeps its native one
  // untouched — we only ever take over the page-level scrollbar. Unconditional
  // and permanent — our own widget always replaces the page-level scrollbar,
  // even on a site that renders its own (no exceptions, by design).
  webFrame.insertCSS(`
    html, body { scrollbar-width: none !important; }
    html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
    /* A site's own custom scrollbar can be a generated ::before/::after
       pseudo-element rather than a real DOM node (quecksilver.ch/documents
       is exactly this — a "page-scrollbar" class directly on <html>, no
       separate widget element to find or hide). hideForeignScrollbarWidgets()
       further below can only ever act on real elements it can query and
       walk — a pseudo-element isn't in the DOM at all, querySelectorAll
       can never return it, so that approach structurally can't reach this
       case. A blanket CSS rule can, though: this doesn't remove or hide
       any REAL content (pseudo-content is always purely decorative), so
       it's safe to apply broadly rather than needing to identify the
       exact element first.
       */
    [class*="scrollbar" i]::before, [class*="scrollbar" i]::after,
    [id*="scrollbar" i]::before, [id*="scrollbar" i]::after { display: none !important; content: none !important; }
  `);
}

function initScrollbar() {
  if (document.getElementById("__qs_scrollbar_host__")) return; // already built (defensive; init only ever runs once per document)

  hideForeignScrollbarWidgets();
  const target = findScrollTarget();
  debugReport(
    target.isDocument ? "built-document" : "built-fallback-element",
    `${target.isDocument ? "" : describeElement(target.el) + " "}scrollHeight=${target.el.scrollHeight} clientHeight=${target.el.clientHeight}`,
  );
  try {
    buildScrollbar(target);
  } catch (err) {
    // A page-specific quirk (a strict CSP, an unexpected DOM shape, ...)
    // could throw partway through building the widget — without this,
    // that silently killed the whole thing with zero indication why. Ends
    // up in the electron:dev terminal via debugReport instead of vanishing.
    debugReport("build-threw", String(err instanceof Error ? err.message : err));
  }
}

// Diagnostic-only — mirrors the tab-preload-loaded ping above, one line per
// tab load, so a report like "still ugly on youtube.com" can be checked
// against exactly what this preload decided and why, instead of guessing.
// Some sites build their own scrollbar as a real DOM widget (a
// track/thumb element, not a native ::-webkit-scrollbar re-skin — those
// are already covered by the unconditional native-hiding CSS above,
// regardless of what class name triggers them). Ours is meant to always
// win — hides anything matching that pattern so it doesn't stack with
// ours instead of just avoiding it. <html>/<body> themselves are excluded:
// a "scrollbar"-named class sitting on one of those is essentially always
// a styling *hook* (e.g. toggling scrollbar-gutter or a
// ::-webkit-scrollbar rule), not a separate widget — hiding either of
// those elements would blank the whole page. data-qs-foreign-scrollbar-
// hidden marks ones already handled so repeated calls (this runs on every
// measure(), to catch a site's widget appearing after our first check —
// see the SPA-routing case this was built for) don't redo the work.
function hideForeignScrollbarWidgets() {
  const isOurs = (el: Element) => el.id?.startsWith("__qs_") || [...el.classList].some((c) => c.startsWith("__qs_"));
  for (const el of document.querySelectorAll<HTMLElement>('[class*="scrollbar" i], [id*="scrollbar" i]')) {
    if (isOurs(el) || el === document.documentElement || el === document.body) continue;
    if (el.dataset.qsForeignScrollbarHidden) continue;
    el.dataset.qsForeignScrollbarHidden = "true";
    // visibility:hidden, not display:none — this element is picked up by a
    // blind class/id-name heuristic, so there's no way to know whether
    // it's an absolutely-positioned widget (safe either way) or something
    // actually contributing to the page's normal layout flow. display:none
    // collapses its box entirely, which can reflow the rest of the page —
    // on at least one site that visibly made things WORSE (a scrollbar
    // came back, just the page's own default one instead of either
    // widget). visibility:hidden hides it just as completely without
    // touching layout at all.
    el.style.setProperty("visibility", "hidden", "important");
  }
}

function debugReport(status: string, detail?: string) {
  ipcRenderer.send("__qs_debug_scrollbar", { url: location.href, status, detail });
}

function describeElement(el: HTMLElement): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

type ScrollTarget = { el: HTMLElement; isDocument: boolean };

// Most sites scroll the document itself (html/body), but some keep <html>
// fixed and scroll an internal container instead — document.scrollingElement
// alone reports those as "not scrollable" and the widget silently never
// appears. Falls back to the largest on-screen element that's both actually
// overflowing its box AND deliberately scrollable (overflow-y: auto/scroll),
// so it doesn't grab some small unrelated scrollable widget (a sidebar
// list, a code block, ...).
//
// Deliberately kept simple: an earlier version tried to detect "html is
// pinned via overflow:hidden" as a separate case and special-cased body —
// that backfired on YouTube specifically (likely a transient overflow:
// hidden from a dismissible banner/dialog at the moment this ran, which
// isn't the page's real, steady-state scroll behavior) and made the widget
// disappear entirely instead of just staying native. The plain
// scrollHeight/clientHeight check below is less clever but far more
// reliable — a false "scrollable" is harmless (the widget just never gets
// anything to scroll), whereas the pinned-detection false positive above
// was actively wrong.
// Short human-readable identifier for a DOM element in debug logs — tag +
// id (if any) + first couple of classes. Not meant to be a full selector,
// just enough for a person reading the console to go find the element via
// DevTools if they need to (e.g. to report exactly which element is
// causing a double-scrollbar sighting).
function describeEl(el: HTMLElement): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "";
  return `<${el.tagName.toLowerCase()}${id}${cls}>`;
}

function findScrollTarget(): ScrollTarget {
  const docEl = (document.scrollingElement || document.documentElement) as HTMLElement;
  if (docEl.scrollHeight > docEl.clientHeight + 1) {
    debugReport("target-chosen", `document is scrollable — using ${describeEl(docEl)}`);
    return { el: docEl, isDocument: true };
  }

  const inner = findLargestScrollableElement();
  if (inner) {
    debugReport("target-chosen", `document not scrollable, picked descendant ${describeEl(inner)}`);
    return { el: inner, isDocument: false };
  }
  debugReport("target-chosen", "document not scrollable, no qualifying descendant found — widget will stay hidden");
  return { el: docEl, isDocument: true };
}

// document.body itself is included as a candidate here — not just its
// descendants — because querySelectorAll("*") on document.body only
// returns body's CHILDREN, never body itself, which would otherwise always
// be missed as a fallback target.
function findLargestScrollableElement(): HTMLElement | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let best: HTMLElement | null = null;
  let bestArea = 0;
  // Every element that scrolls AND is reasonably sized, whether or not it
  // wins — logged once below so a "double scrollbar" report has something
  // concrete to point at: if this list has 2+ entries, whichever one we
  // DIDN'T pick is almost certainly the other scrollbar the person is
  // seeing (its native one, since we only ever hide the winner's).
  const runnerUps: HTMLElement[] = [];

  const candidates: HTMLElement[] = document.body ? [document.body, ...document.body.querySelectorAll<HTMLElement>("*")] : [];
  for (const el of candidates) {
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    const style = getComputedStyle(el);
    // "overlay" is a legacy WebKit-only value (still used by some sites)
    // for a scrollbar that floats over content instead of taking up layout
    // space — functionally scrollable same as auto/scroll, just missed by
    // a stricter check.
    if (style.overflowY !== "auto" && style.overflowY !== "scroll" && style.overflowY !== "overlay") continue;

    const rect = el.getBoundingClientRect();
    // Only the primary content region counts — must cover a meaningful
    // share of the viewport, or a small inner scroll box (a comment list,
    // a code snippet) would win over the real page-level content. Width
    // is deliberately more lenient than height (30% vs 50%) — a real
    // content column (e.g. a menu/article list next to a sidebar) is
    // often well under half the viewport's width while still being
    // exactly the scrollable region the person actually needs a
    // scrollbar for.
    if (rect.width < vw * 0.3 || rect.height < vh * 0.5) continue;

    runnerUps.push(el);
    const visibleW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
    const visibleH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    const area = visibleW * visibleH;
    if (area > bestArea) {
      bestArea = area;
      best = el;
    }
  }
  if (runnerUps.length > 1) {
    debugReport(
      "multiple-scrollable-found",
      `${runnerUps.length} qualifying elements — winner: ${best ? describeEl(best) : "none"}; all: ${runnerUps.map(describeEl).join(", ")}`,
    );
  }
  return best;
}

function buildScrollbar(target: ScrollTarget) {
  const SCROLL_STEP = 120;
  // Both mutable — see retarget() below. The scroll target chosen here is
  // only ever a first guess: if the document itself isn't scrollable and
  // no qualifying descendant exists YET (a common SPA pattern — the real
  // scrollable content loads in after an API call, findScrollTarget() at
  // build time just sees an empty shell), this used to lock in "not
  // scrollable" forever and never look again, which is exactly why the
  // widget stayed hidden on pages whose content shows up late.
  let scrollEl = target.el;
  // Document-level scroll fires "scroll" on window (not reliably on
  // <html>/<body> across engines); an internal container fires it on
  // itself. Both cases read/write the same scrollEl for position/size.
  let scrollEventTarget: Window | HTMLElement = target.isDocument ? window : scrollEl;
  let isDocumentTarget = target.isDocument;

  // Always present (not just when the initial target is an element) —
  // retarget() below can switch from the document to a real element
  // after the fact, and needs this rule already in the page for the
  // attribute toggle to have any effect.
  const hideStyle = document.createElement("style");
  hideStyle.textContent = `
    [data-qs-hide-native-scrollbar] { scrollbar-width: none !important; }
    [data-qs-hide-native-scrollbar]::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  `;
  document.head.appendChild(hideStyle);
  if (!isDocumentTarget) {
    // The document-start CSS at the top of this file only ever hides
    // html's own native scrollbar — when we fall back to an internal
    // scroll container (findScrollTarget above), that container's native
    // scrollbar was never hidden, so it kept showing right alongside (or
    // underneath) our own widget. Scoped to this exact element via a
    // marker attribute, since inline styles can't target the
    // ::-webkit-scrollbar pseudo-element.
    scrollEl.setAttribute("data-qs-hide-native-scrollbar", "");
  }

  const host = document.createElement("div");
  host.id = "__qs_scrollbar_host__";
  Object.assign(host.style, {
    position: "fixed",
    top: "0",
    right: "0",
    width: "14px",
    height: "100vh",
    zIndex: "2147483647",
    display: "none", // shown by update() once the page turns out to scroll
  });
  document.documentElement.appendChild(host);
  // Shadow DOM keeps the page's own (often very aggressive, global) CSS
  // from leaking in and mangling our widget, and vice versa.
  const shadow = host.attachShadow({ mode: "closed" });

  // Built with createElement/appendChild rather than an innerHTML string —
  // sites that enforce a Trusted Types CSP (YouTube among them) throw a
  // TypeError on any raw innerHTML/outerHTML assignment, which silently
  // killed this entire function before it ever got to wiring up update()
  // or the event listeners. DOM construction APIs aren't subject to
  // Trusted Types at all, so this sidesteps the restriction entirely
  // regardless of which specific policy a page has.
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .col { position: absolute; inset: 0; display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .arrow { flex-shrink: 0; height: 22px; width: 100%; display: flex; align-items: center; justify-content: center; background: transparent; border: none; padding: 0; cursor: pointer; opacity: 0.7; transition: opacity 0.12s; color: hsl(0 0% 30%); }
    .arrow:hover:not(:disabled) { opacity: 1; }
    .arrow:disabled { cursor: default; opacity: 0.25; }
    .track { flex: 1; position: relative; }
    .thumb { position: absolute; left: 3px; right: 3px; border-radius: 9999px; background: hsl(240 4% 46% / 0.35); cursor: grab; transition: background 0.12s; will-change: top, height; }
    .thumb:hover, .thumb.dragging { background: hsl(240 4% 46% / 0.55); cursor: grabbing; }
  `;
  shadow.appendChild(style);

  const SVG_NS = "http://www.w3.org/2000/svg";
  function makeArrowSvg(d: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "8");
    svg.setAttribute("viewBox", "0 0 12 8");
    svg.setAttribute("fill", "currentColor");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
  }

  const col = document.createElement("div");
  col.className = "col";

  const btnUp = document.createElement("button");
  btnUp.className = "arrow";
  btnUp.id = "qs-up";
  btnUp.type = "button";
  btnUp.setAttribute("aria-label", "Scroll up");
  btnUp.appendChild(makeArrowSvg("M6 1.5C6.3 1.5 6.5 1.6 6.7 1.8L10.5 6.2C10.9 6.7 10.6 7.5 9.9 7.5H2.1C1.4 7.5 1.1 6.7 1.5 6.2L5.3 1.8C5.5 1.6 5.7 1.5 6 1.5Z"));

  const track = document.createElement("div");
  track.className = "track";
  track.id = "qs-track";
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  thumb.id = "qs-thumb";
  track.appendChild(thumb);

  const btnDown = document.createElement("button");
  btnDown.className = "arrow";
  btnDown.id = "qs-down";
  btnDown.type = "button";
  btnDown.setAttribute("aria-label", "Scroll down");
  btnDown.appendChild(makeArrowSvg("M6 6.5C5.7 6.5 5.5 6.4 5.3 6.2L1.5 1.8C1.1 1.3 1.4 0.5 2.1 0.5H9.9C10.6 0.5 10.9 1.3 10.5 1.8L6.7 6.2C6.5 6.4 6.3 6.5 6 6.5Z"));

  col.appendChild(btnUp);
  col.appendChild(track);
  col.appendChild(btnDown);
  shadow.appendChild(col);


  // Split on purpose: measure() does the expensive forced-layout reads
  // (scrollHeight/clientHeight/track height) and only needs to run when
  // the page's actual SIZE could have changed — resize, DOM mutations,
  // initial load. render() just repositions the thumb using scrollTop
  // (cheap) against those already-known sizes. Plain scrolling was
  // needlessly re-running the expensive measure() on every single frame
  // before, forcing a full layout recalculation while the browser was
  // simultaneously trying to paint the scroll itself — that fight is what
  // made normal wheel-scrolling look jerky (dragging the thumb was
  // already smooth, since that path never went through this at all).
  let cachedTrackH = 0;
  let cachedScrollH = 0;
  let cachedClientH = 0;
  let measureLogCount = 0;
  // Once a real scrollable target is confirmed, there's nothing left to
  // retry — this also caps how long retarget() below keeps re-scanning
  // the whole document on every mutation (cheap-ish, but not free).
  let confirmedScrollable = false;

  // Re-runs findScrollTarget() and switches scrollEl/scrollEventTarget to
  // whatever it finds NOW, if that's different from (and better than)
  // what's currently set — see the comment on scrollEl's declaration
  // above for why this needs to exist at all. Only called from measure()
  // while nothing scrollable has been confirmed yet.
  function retarget() {
    const fresh = findScrollTarget();
    if (fresh.el === scrollEl) return;
    if (fresh.el.scrollHeight <= fresh.el.clientHeight + 1) return; // not actually an improvement
    debugReport("retargeted", `switched from ${describeEl(scrollEl)} to ${describeEl(fresh.el)}`);
    scrollEventTarget.removeEventListener("scroll", scheduleRender);
    scrollEl = fresh.el;
    scrollEventTarget = fresh.isDocument ? window : scrollEl;
    isDocumentTarget = fresh.isDocument;
    if (!isDocumentTarget) scrollEl.setAttribute("data-qs-hide-native-scrollbar", "");
    scrollEventTarget.addEventListener("scroll", scheduleRender, { passive: true } as AddEventListenerOptions);
  }

  function measure() {
    hideForeignScrollbarWidgets();
    if (!confirmedScrollable) retarget();
    cachedTrackH = track.clientHeight;
    cachedScrollH = scrollEl.scrollHeight;
    cachedClientH = scrollEl.clientHeight;
    if (cachedScrollH > cachedClientH + 1) confirmedScrollable = true;

    if (measureLogCount < 3) {
      measureLogCount++;
      debugReport("update", `#${measureLogCount} scrollable=${cachedScrollH > cachedClientH + 1} scrollH=${cachedScrollH} clientH=${cachedClientH}`);
    }

    render();
  }

  function render() {
    const scrollable = cachedScrollH > cachedClientH + 1;
    host.style.display = scrollable ? "block" : "none";
    if (!scrollable || cachedTrackH === 0) return;

    const scrollTop = scrollEl.scrollTop;
    btnUp.disabled = scrollTop <= 1;
    btnDown.disabled = scrollTop + cachedClientH >= cachedScrollH - 1;

    const ratio = cachedClientH / cachedScrollH;
    const h = Math.max(36, cachedTrackH * ratio);
    const maxTop = cachedTrackH - h;
    const top = (scrollTop / (cachedScrollH - cachedClientH)) * maxTop;
    thumb.style.height = h + "px";
    thumb.style.top = Math.min(Math.max(top, 0), maxTop) + "px";
  }

  // Coalesces bursts of events into at most one measure()/render() per
  // animation frame, on top of the measure/render split above.
  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }
  let measureScheduled = false;
  function scheduleMeasure() {
    if (measureScheduled) return;
    measureScheduled = true;
    requestAnimationFrame(() => {
      measureScheduled = false;
      measure();
    });
  }

  // Listens on the actual scroll target — window for document-level scroll,
  // the container element itself when we fell back to an internal scroll
  // div (see findScrollTarget above). Only re-renders (cheap) — plain
  // scrolling doesn't change the page's overall size.
  scrollEventTarget.addEventListener("scroll", scheduleRender, { passive: true } as AddEventListenerOptions);
  // Resizing the window can change layout enough to affect scrollHeight —
  // needs a full re-measure.
  window.addEventListener("resize", scheduleMeasure);
  // Catches content that grows the page without firing scroll/resize —
  // infinite-scroll feeds, lazy-loaded sections, late images, SPA route
  // changes that don't reload the document. Disconnected after the page
  // has had time to settle (see below) — a churny SPA (YouTube's
  // recommendations, live chat, player UI, ...) keeps mutating its DOM
  // forever, and there's rapidly diminishing value in re-measuring on
  // every single one of those once the page's overall scrollable height
  // has stabilized; scroll/resize still catch anything that matters after
  // that point.
  const mutationObserver = new MutationObserver(scheduleMeasure);
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => mutationObserver.disconnect(), 8000);

  btnUp.addEventListener("mousedown", (e) => {
    e.preventDefault();
    scrollEl.scrollBy({ top: -SCROLL_STEP, behavior: "smooth" });
  });
  btnDown.addEventListener("mousedown", (e) => {
    e.preventDefault();
    scrollEl.scrollBy({ top: SCROLL_STEP, behavior: "smooth" });
  });

  thumb.addEventListener("mousedown", (e) => {
    e.preventDefault();
    thumb.classList.add("dragging");
    const startY = e.clientY;
    const startScroll = scrollEl.scrollTop;
    const trackH = track.clientHeight;
    const thumbH = thumb.offsetHeight;
    const scrollRange = scrollEl.scrollHeight - scrollEl.clientHeight;
    const trackRange = trackH - thumbH;

    // Mousemove fires far more often than once per frame — coalescing to
    // one rAF per frame, and moving the thumb with a direct render() call
    // in that same frame instead of waiting on the native "scroll" event
    // the scrollTop write triggers, keeps it visually locked to the cursor.
    let pendingClientY: number | null = null;
    let dragFrameScheduled = false;

    function applyDrag() {
      dragFrameScheduled = false;
      if (pendingClientY === null) return;
      const ratio = trackRange > 0 ? (pendingClientY - startY) / trackRange : 0;
      scrollEl.scrollTop = Math.max(0, Math.min(scrollRange, startScroll + ratio * scrollRange));
      render();
    }

    function onMove(ev: MouseEvent) {
      pendingClientY = ev.clientY;
      if (dragFrameScheduled) return;
      dragFrameScheduled = true;
      requestAnimationFrame(applyDrag);
    }
    function onUp() {
      thumb.classList.remove("dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  requestAnimationFrame(measure);
  setTimeout(measure, 150);
  setTimeout(measure, 1200); // one more pass for pages that keep growing after load (lazy content, web fonts reflowing layout, ...)
  // Show it immediately, synchronously, right now — don't wait on the
  // deferred passes above at all for the very first paint. We already know
  // scrollEl really is scrollable at this exact moment (that's why
  // buildScrollbar was called), so there's no reason the widget's initial
  // visibility should depend on requestAnimationFrame or a timer firing;
  // both can be delayed or throttled (a backgrounded/inactive tab pauses
  // rAF entirely in Chromium), and that's exactly the kind of thing that
  // would explain "built the widget but it never actually showed up".
  measure();
}

// 'load' (not DOMContentLoaded) — needs every stylesheet actually fetched
// for pageStylesOwnScrollbar() to see real rules, not an empty/half-parsed
// sheet. The native scrollbar is already hidden from document-start above,
// so there's no flash of Chromium's default one in the meantime either way.
// Main-frame-only, same reasoning as the top of the file — a scrollbar
// widget has no business appearing inside a random ad iframe.
if (process.isMainFrame) {
  if (document.readyState === "complete") {
    initScrollbar();
  } else {
    window.addEventListener("load", initScrollbar);
  }
}

// --- Password autofill -------------------------------------------------------
//
// Looks up saved passwords for the current page's hostname and, if there's
// exactly one match, fills the page's own login form with it directly. With
// more than one match (two genuinely different saved accounts for the same
// site), shows a small picker dropdown right under the field instead of
// guessing — built the same way the custom scrollbar is (a Shadow DOM host
// element injected straight into the page's own DOM), not some Electron-
// level overlay; there's no restriction stopping this, "we can't draw over
// the native page" was never actually the limitation.
// Two separate flags, not one — a field that came up with zero saved
// matches should be allowed to try again later (the person might save a
// password for this exact site moments later, in the same tab, without a
// reload), while a field that's already been filled (or shown a picker
// for) should never be re-touched. Blocking retries unconditionally after
// ANY attempt — including a "found nothing" one — is what made a login
// that worked once and a login that worked five minutes later on the same
// still-open tab behave differently for no visible reason.
let autofillPendingField: HTMLInputElement | null = null;
let autofillResolvedField: HTMLInputElement | null = null;

function pwDebug(status: string, detail?: string) {
  ipcRenderer.send("__qs_debug_passwords", { url: location.href, status, detail });
}

// Plain document.querySelector() can never see into an OPEN shadow root —
// it only searches the "light DOM". Modern component libraries (design
// systems built as Web Components) commonly put their actual <input>
// inside one, which would make a real, visible password field completely
// invisible to every check in this file so far, no matter how the
// MutationObserver is configured — this isn't a timing problem at all in
// that case, there's structurally nothing in the light DOM to ever find.
// CLOSED shadow roots (element.shadowRoot returns null for those) are a
// hard wall we genuinely cannot see past; open ones we can walk into.
function deepQuerySelectorAll<T extends Element>(root: ParentNode, selector: string): T[] {
  const found: T[] = Array.from(root.querySelectorAll<T>(selector));
  for (const el of root.querySelectorAll<Element>("*")) {
    if (el.shadowRoot) found.push(...deepQuerySelectorAll<T>(el.shadowRoot, selector));
  }
  return found;
}

// Fired once, a couple of seconds after load, regardless of whether a
// password field was ever found — reports what's actually on the page so
// a "still doesn't work" report comes with real numbers instead of
// needing yet another guess. If lightPasswordInputs is 0 but
// shadowPasswordInputs isn't, that's conclusive: the field exists, it's
// just behind an open shadow boundary our normal search never looked
// inside. If both are 0, there's genuinely no password field in the DOM
// at the time this ran (a step not reached yet, or a closed shadow root).
let siteDiagnosticSent = false;
function sendSiteDiagnostic() {
  if (siteDiagnosticSent) return;
  siteDiagnosticSent = true;
  const lightInputs = document.querySelectorAll("input").length;
  const lightPasswordInputs = document.querySelectorAll('input[type="password"]').length;
  const shadowRoots = countShadowRoots(document);
  const deepPasswordInputs = deepQuerySelectorAll<HTMLInputElement>(document, 'input[type="password"]');
  pwDebug(
    "site-diagnostic",
    `totalInputs=${lightInputs} lightPasswordInputs=${lightPasswordInputs} openShadowRoots=${shadowRoots} deepPasswordInputs=${deepPasswordInputs.length}` +
      (deepPasswordInputs.length > 0 ? ` deepFirstVisible=${deepPasswordInputs.some((el) => el.offsetParent !== null)}` : ""),
  );
}
function countShadowRoots(root: ParentNode): number {
  let count = 0;
  for (const el of root.querySelectorAll<Element>("*")) {
    if (el.shadowRoot) count += 1 + countShadowRoots(el.shadowRoot);
  }
  return count;
}

function initAutofill() {
  // A light-DOM-only field first (cheap, covers the overwhelming majority
  // of sites) — only pays for the full shadow-piercing walk if that comes
  // up empty.
  let pwField = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (!pwField || pwField.offsetParent === null) {
    const deep = deepQuerySelectorAll<HTMLInputElement>(document, 'input[type="password"]').find((el) => el.offsetParent !== null);
    if (deep) pwField = deep;
  }
  // Many login forms (Google among them) don't exist in the initial HTML
  // at all, or sit behind a first "enter your email" step — nothing to do
  // yet, the MutationObserver below re-tries once one actually shows up.
  if (!pwField || pwField.offsetParent === null) return;
  if (pwField === autofillPendingField || pwField === autofillResolvedField) return; // already in flight or already handled
  autofillPendingField = pwField;

  pwDebug("autofill-found-field", process.isMainFrame ? undefined : "in subframe");
  ipcRenderer
    .invoke("passwords:findForHost", location.hostname)
    .then(async (matches: { username: string; password: string; updatedAt: number }[]) => {
      pwDebug("autofill-lookup-result", `matches=${Array.isArray(matches) ? matches.length : "not-array"}`);
      if (!Array.isArray(matches) || matches.length === 0) {
        autofillPendingField = null; // nothing found — leave it retryable, see the comment above
        return;
      }
      autofillResolvedField = pwField;
      autofillPendingField = null;
      if (!pwField.isConnected) {
        pwDebug("autofill-field-gone", "password field was removed from the page before the lookup resolved");
        return;
      }
      const userField = findUsernameField(pwField);

      // More than one saved login for this host — rather than asking
      // (there used to be a picker dropdown here), just goes with
      // whichever one was updated most recently. Simpler, and matches
      // what most people actually want: the account they've used last.
      const match = matches.length > 1 ? [...matches].sort((a, b) => b.updatedAt - a.updatedAt)[0]! : matches[0]!;
      if (matches.length > 1) pwDebug("autofill-multiple-matches", `choices=${matches.length}, picked most recently updated`);
      // findUsernameField alone only ever finds a field that's actually
      // present on THIS page — on a password-only step of a multi-step
      // login (see resolveUsername/watchForUsernameTyping above), there's
      // nothing to search for at all, so this used to just silently skip
      // filling the username every time that pattern applied.
      if (userField) {
        const value = userField.value || match.username;
        if (value) setNativeValue(userField, value);
        pwDebug("autofill-userfield", `tag=${userField.tagName} type=${userField.type} name=${userField.name || "?"} hadValue=${Boolean(userField.value)} filled=${Boolean(value)}`);
      } else {
        pwDebug("autofill-userfield", "none found on this page");
      }
      setNativeValue(pwField, match.password);
      pwDebug("autofill-filled", `userField=${Boolean(userField)}`);
    })
    .catch((err) => {
      autofillPendingField = null;
      pwDebug("autofill-lookup-threw", String(err instanceof Error ? err.message : err));
      console.error("[autofill] lookup failed:", err);
    });
}


// The field that actually holds the username/email — prefers an explicit
// autocomplete hint (what well-built forms use on purpose), then falls
// back to the nearest text/email input that appears before the password
// field in the same form (or the whole document, for pages with no <form>
// wrapper at all).
function findUsernameField(pwField: HTMLInputElement): HTMLInputElement | null {
  const scope: ParentNode = pwField.closest("form") ?? document;
  const explicit = scope.querySelector<HTMLInputElement>('input[autocomplete="username"], input[autocomplete="email"]');
  if (explicit) return explicit;

  const allInputs = Array.from(scope.querySelectorAll("input"));
  const pwIndex = allInputs.indexOf(pwField);
  const candidates = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input:not([type])')).filter(
    (c) => c.offsetParent !== null, // skip hidden fields
  );

  // Strongly prefers the closest candidate BEFORE the password field
  // (the overwhelmingly common layout: username, then password) — but
  // some forms genuinely place it after in DOM order despite looking
  // "before" visually (a CSS-reordered flex/grid layout, quecksilver.ch's
  // own login among them). Requiring "before" unconditionally meant those
  // forms never got a username candidate at all; falling back to the
  // closest one after still beats leaving the field empty.
  let bestBefore: HTMLInputElement | null = null;
  let bestAfter: HTMLInputElement | null = null;
  for (const candidate of candidates) {
    const candidateIndex = allInputs.indexOf(candidate);
    if (pwIndex === -1) {
      bestBefore = candidate;
    } else if (candidateIndex < pwIndex) {
      bestBefore = candidate; // last one found before the password field wins
    } else if (!bestAfter) {
      bestAfter = candidate; // first one found after the password field
    }
  }
  return bestBefore ?? bestAfter;
}

// Many real login flows (Google among them) ask for the username/email on
// one step and the password on a separate later step, often a full
// navigation — by the time the password field shows up, the username
// field from the earlier step is simply gone from this page's DOM, and
// findUsernameField() above has nothing to find. Watches every visible
// text/email-looking field on every page (not just ones near a password
// field — the username-only step usually has no password field at all)
// and remembers whatever was last typed, in the main process, keyed by
// hostname, so a later password-only step can still pair it up. Never
// written to disk — gone the moment the app restarts.
function watchForUsernameTyping() {
  const candidates = document.querySelectorAll<HTMLInputElement>(
    'input[autocomplete="username"], input[autocomplete="email"], input[type="email"], input[type="text"]',
  );
  for (const el of candidates) {
    if (el.dataset.qsUsernameWatched) continue; // don't attach twice on repeated MutationObserver passes
    el.dataset.qsUsernameWatched = "1";
    el.addEventListener("blur", () => {
      if (el.value) ipcRenderer.send("passwords:rememberUsername", { host: location.hostname, username: el.value });
    });
  }
}

async function resolveUsername(pwField: HTMLInputElement): Promise<string> {
  const field = findUsernameField(pwField);
  if (field?.value) return field.value;
  try {
    const remembered = await ipcRenderer.invoke("passwords:getRememberedUsername", location.hostname);
    return typeof remembered === "string" ? remembered : "";
  } catch {
    return "";
  }
}

// Plain `input.value = x` is silently ignored by React (and most other
// component frameworks) — they track value through the native property
// setter and only re-render on the "input" event, so both are needed:
// call the real setter Chromium provides, THEN fire the events a real
// keystroke would have fired.
// Plain `input.value = x` is silently ignored by React (and most other
// component frameworks) — they track value through the native property
// setter and only re-render on the "input" event, so both are needed:
// call the real setter Chromium provides, THEN fire the events a real
// keystroke would have fired.
//
// Retries once, shortly after — some React forms re-render on an unrelated
// state change right around when we fill (a loading spinner, a debounced
// validation check, ...) and either replace the input with a fresh DOM
// node (our first fill lands on a now-detached ghost) or a controlled
// input snaps back to whatever React's own state still says the value is,
// because our dispatched "input" event arrived a tick before React
// re-rendered over it. A single delayed re-check catches both without
// turning this into an open-ended polling loop.
function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  const apply = (el: HTMLInputElement) => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  apply(input);
  setTimeout(() => {
    if (!input.isConnected) return; // page replaced this exact node — nothing more we can do for it, a fresh initAutofill() pass (via the MutationObserver) handles the new one
    if (input.value !== value) apply(input);
  }, 150);
}

// When a login is submitted with a password that's new or different from
// what's already saved for this host+username, saves it automatically (no
// "Save password?" prompt) and tells the main process, which shows a brief
// confirmation pill in the header (see routes/index.tsx).
async function capturePasswordFromPage(source: string) {
  const pwField = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (!pwField || !pwField.value) return;
  // Captured as a plain string synchronously, before the async username
  // lookup below — the page's own click handler (fetch, navigation, ...)
  // keeps running concurrently and could clear/unmount this field before
  // that lookup resolves.
  const password = pwField.value;
  const username = await resolveUsername(pwField);
  pwDebug("autosave-capture", `source=${source} hasUsername=${Boolean(username)}`);
  ipcRenderer
    .invoke("passwords:autoSaveFromForm", { url: location.hostname, username, password })
    .then((result: unknown) => pwDebug("autosave-result", JSON.stringify(result)))
    .catch((err) => {
      pwDebug("autosave-threw", String(err instanceof Error ? err.message : err));
      console.error("[autofill] auto-save failed:", err);
    });
}

try {
  if (document.readyState === "complete") {
    initAutofill();
  } else {
    window.addEventListener("load", initAutofill);
  }
  // Unconditional — fires regardless of whether a password field was ever
  // found, 2.5s after this script started (enough time for most SPA
  // login forms to have rendered whatever they're going to render).
  setTimeout(sendSiteDiagnostic, 2500);
  // Covers login forms that render after the initial load (a JS-rendered
  // form, or a multi-step "email first, then password" flow) — re-checks
  // whenever the DOM changes rather than guessing at a fixed delay.
  //
  // Observes `document` itself, not document.documentElement — this line
  // runs immediately at script top-level (unlike everything else here,
  // which waits for 'load'), and documentElement can still be null this
  // early (true document-start timing). Observing document works exactly
  // the same for childList/subtree mutations and always exists, sidestepping
  // the race entirely.
  //
  // Also watches style/class/hidden attribute changes, not just elements
  // being added/removed — a very common pattern (React modals/dialogs
  // among them, GeoGuessr's sign-in included) inserts the login form into
  // the DOM early while still hidden, then reveals it later purely by
  // toggling a class or style attribute with no new elements involved at
  // all. childList alone never sees that reveal, so the form's
  // offsetParent stayed null forever from this code's point of view even
  // though it was genuinely visible on screen by the time anyone actually
  // looked at the page — this is what made autofill work on one visit to
  // the exact same URL and not the next.
  new MutationObserver(() => initAutofill()).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });

  // --- SPA navigation (History API) --------------------------------------
  //
  // The actual root cause behind GeoGuessr specifically: clicking "Sign
  // in" there changes the URL from /de to /de/signin WITHOUT a real page
  // load at all — a client-side route change via history.pushState(),
  // extremely common for React/Vue/etc. single-page apps. This whole
  // script only ever runs ONCE per real navigation (Electron injects a
  // fresh copy on each did-navigate), so every check above — including
  // the "continuously watching" MutationObserver — was still only ever
  // set up for the FIRST url. It kept faithfully watching the DOM the
  // whole time, but nothing here ever knew the *page* had effectively
  // changed underneath it, so state that should reset per-route (having
  // already given up on one page's password field) never did.
  //
  // Patching pushState/replaceState (popstate alone only fires for
  // back/forward, never for an app calling pushState itself) and re-
  // running the whole detection pass on any URL change fixes this
  // properly instead of just hoping the existing observer eventually
  // notices.
  let lastHref = location.href;
  function onSpaNavigation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    pwDebug("spa-navigation", location.href);
    autofillPendingField = null;
    autofillResolvedField = null;
    siteDiagnosticSent = false;
    // A short delay, not immediate — the new route's content (React
    // rendering the sign-in form, for example) still needs a moment to
    // actually mount after the URL itself changes.
    setTimeout(initAutofill, 400);
    setTimeout(sendSiteDiagnostic, 2500);
  }
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      onSpaNavigation();
      return result;
    };
  }
  window.addEventListener("popstate", onSpaNavigation);

  // Attaches the username-typing watcher now and re-attaches on every DOM
  // change too (new fields render constantly on SPA-style login flows).
  watchForUsernameTyping();
  new MutationObserver(() => watchForUsernameTyping()).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });

  // --- Auto-save on submit / submit-like click --------------------------
  //
  // When a login is submitted with a password that's new or different from
  // what's already saved for this host+username, saves it automatically
  // (no "Save password?" prompt) and tells the main process, which shows a
  // brief confirmation pill in the header (see routes/index.tsx).
  //
  // Two capture paths, because a real <form> "submit" event never fires at
  // all on the very common pattern of a JS onClick handler that calls
  // preventDefault() and does its own fetch() (most modern SPA login UIs,
  // Google included) — the click listener below catches those too, by
  // snapshotting whatever password field has a value at the moment of any
  // click, not just ones inside an actual form submission.
  document.addEventListener(
    "submit",
    (e) => {
      if (e.target instanceof HTMLFormElement) capturePasswordFromPage("submit-event");
    },
    true, // capture — fires before the page's own submit handler can call preventDefault() and stop it from bubbling
  );

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const button = target.closest<HTMLElement>('button, input[type="submit"], [role="button"]');
      if (!button) return;
      // Fires on ANY button-like click, not just ones that look like a
      // "sign in" button by label — deliberately broad, since login button
      // text varies wildly ("Sign in", "Log in", "Continue", a translated
      // string, an icon with no text at all) and there's no reliable way
      // to detect intent from the label. capturePasswordFromPage() itself
      // is the actual filter: it only ever does anything if a password
      // field on the page currently has a non-empty value.
      capturePasswordFromPage("button-click");
    },
    true,
  );

  pwDebug("setup-complete");
} catch (err) {
  // This is exactly the kind of failure that silently broke BOTH autofill
  // and auto-save at once before: one uncaught throw anywhere in this
  // top-level block used to stop every statement after it from ever
  // running (a null-target MutationObserver.observe() call was the actual
  // culprit, fixed above) — wrapping the whole thing means a future
  // regression like that shows up as a clear log line instead of just
  // "nothing happens".
  pwDebug("setup-threw", String(err instanceof Error ? err.message : err));
  console.error("[autofill] setup failed:", err);
}

// Dedicated preload for every browsed tab (not the chrome UI's own preload).
//
// One job, scoped to this one tab's page: password autofill/autosave, and
// modifier-click/middle-click link handling. Scrollbars are deliberately
// left alone in the sense that matters — a page that styles its own
// scrollbar keeps that exactly as it renders it, no forced override, no
// custom widget, no hide-and-replace. The one thing this file does add is
// a plain DEFAULT look for scrollbars a page does NOT style itself (see
// insertDefaultScrollbarCss below) — vanilla Chromium's own built-in
// scrollbar (thick, square, edge-to-edge) looks noticeably worse than
// what Edge shows by default for the exact same unstyled case, and there's
// no reason to inherit that here when a nicer default costs nothing.
import { ipcRenderer, webFrame } from "electron";

// Applied via the universal selector (`*`), the lowest possible CSS
// specificity there is — any real page rule, even a plain `div::-webkit-
// scrollbar`, naturally wins over this without needing `!important`
// anywhere. Inserted once at document-start, before the page's own
// stylesheets exist yet, so ties at equal specificity also resolve in the
// page's favor (later in document order wins).
//
// Confirmed on claude.ai (Aug 2026): a page that sets its own
// scrollbar-width/scrollbar-color (the standardized property, not
// ::-webkit-scrollbar) keeps its own look even though this rule below
// still gets inserted successfully — Chromium prefers scrollbar-width/
// -color over ::-webkit-scrollbar rules whenever both exist on the same
// element, regardless of specificity. That's deliberately left as-is:
// the page's own choice wins, even when it looks worse than what this
// file would have given it — same principle as not fighting a page's own
// ::-webkit-scrollbar rules. This can't guarantee a win against every
// possible site rule either way — that's what the old hide-and-replace
// system that used to live in this file was actually for, and it's
// deliberately gone now in favor of just not fighting the page. Same
// visual recipe as this app's own chrome UI's .custom-scrollbar class
// (src/styles.css), so the two match instead of looking like two
// different browsers.
function insertDefaultScrollbarCss() {
  webFrame.insertCSS(`
    *::-webkit-scrollbar { width: 12px; height: 12px; }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb {
      background-color: #9a9a9a;
      border-radius: 999px;
      border: 3px solid transparent;
      background-clip: padding-box;
      min-height: 40px;
    }
    *::-webkit-scrollbar-thumb:hover { background-color: #757575; }
    *::-webkit-scrollbar-button {
      display: block;
      height: 14px;
      background-color: transparent;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 9px 9px;
    }
    *::-webkit-scrollbar-button:vertical:decrement {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239a9a9a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='18 15 12 9 6 15'/%3E%3C/svg%3E");
    }
    *::-webkit-scrollbar-button:vertical:increment {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239a9a9a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    }
  `);
}

// Diagnostic-only: confirms in the electron:dev terminal that this preload
// actually loaded and ran for this tab. Safe to leave in; it's one
// ipcRenderer.send per tab load.
//
// Main-frame-only — nodeIntegrationInSubFrames (tab-manager.ts) now also
// injects this same script into every <iframe> on the page (needed so
// password autofill/autosave can reach a login form embedded in one, e.g.
// Wix's sign-in widget), and logging this once per random ad/embed iframe
// on every page would drown out anything useful. Autofill logic further
// below deliberately does NOT have this guard — it's meant to run in
// every frame. The default scrollbar CSS above is also injected into
// every frame, not just the main one — an ad/embed iframe with its own
// scrollable area deserves the same nicer default as everything else.
if (process.isMainFrame) {
  ipcRenderer.send("__qs_debug_tab_preload_loaded", location.href);
}
insertDefaultScrollbarCss();

// --- Modifier-click / middle-click links open in a new tab -----------------
//
// A plain left-click on a link is left completely alone — that's the one
// browsers agree on everywhere, and it's what tab-manager.ts's normal
// will-navigate handling already does. What was missing is the *other*
// standard way every real browser lets you open a link without leaving the
// page you're on: Ctrl/Cmd-click, Shift-click, and middle-click. Electron
// doesn't give any of these special treatment on its own for a plain
// same-window `<a href>` navigation (unlike target="_blank", which is
// already handled separately via setWindowOpenHandler in tab-manager.ts) —
// without this, every link click looked identical to Electron regardless of
// which modifier was held, so there was never a way to open something
// in the background short of the right-click menu.
//
// Not main-frame-only: a link worth Ctrl/Cmd-clicking can just as easily
// sit inside an embedded frame (same reasoning as the autofill listeners
// below).
document.addEventListener(
  "click",
  (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || !link.href) return;
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.invoke("links:openInNewTab", link.href).catch(() => {});
  },
  true, // capture — beats the page's own click handler to the punch, same as the autofill click listener further below
);

// Middle-click (mouse button 1) is its own event, separate from "click" —
// browsers fire "auxclick" for it, not "click". Same new-tab behavior as
// the modifier-clicks above.
document.addEventListener(
  "auxclick",
  (e) => {
    if (e.button !== 1) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || !link.href) return;
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.invoke("links:openInNewTab", link.href).catch(() => {});
  },
  true,
);

// --- Password autofill -------------------------------------------------------
//
// Looks up saved passwords for the current page's hostname and, if there's
// exactly one match, fills the page's own login form with it directly. With
// more than one match (two genuinely different saved accounts for the same
// site), shows a small picker dropdown right under the field instead of
// guessing — built as a Shadow DOM host element injected straight into
// the page's own DOM, not some Electron-level overlay; there's no
// restriction stopping this, "we can't draw over the native page" was
// never actually the limitation.
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

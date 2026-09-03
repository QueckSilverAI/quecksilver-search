import { app, session as electronSession, BrowserWindow, webContents } from "electron";
import { getSitePermission, recordDefaultBlock, type PermissionKind } from "./site-permissions-store";
import { isFeatureDisabledForDomain, type SiteOverridableFeature } from "./site-feature-overrides-store";
import { recordHttpsUpgrade, consumeHttpExemption } from "./https-upgrade-tracker";
import { getPrivacySettings } from "./privacy-settings-store";
import { BUNDLED_AD_BLOCK_DOMAINS } from "./adblock-domains";
import {
  adBlockEnabled,
  doNotTrackEnabled,
  cookiesBlocked,
  cameraGloballyBlocked,
  micGloballyBlocked,
  locationGloballyBlocked,
  imagesGloballyDisabled,
  doNotDisturbEnabled,
  customBlockedPatternsSetting,
  getControlCenterSettings,
} from "./control-center-store";
import { incrementTrackerCount } from "./tracker-count-store";
import { addBandwidthBytes } from "./bandwidth-store";
import { recordRequestStart, recordRequestCompleted } from "./request-log-store";
import { findMatchingMock } from "./request-mocks-store";

// Applied once, globally, to session.defaultSession — every tab's
// WebContentsView uses that session (no per-profile partitioning exists
// in this app, see profile-store.ts), so one call here covers every tab
// in every window.

// A compact, hand-picked list — kept ALONGSIDE the bundled list below
// (adblock-domains.ts) rather than replaced by it, specifically for
// entries the bundled list can't express: a couple of these are
// PATH-scoped, not whole-domain (e.g. "facebook.com/tr" blocks just
// Facebook's tracking-pixel path while leaving the rest of facebook.com,
// which people are actively browsing, completely alone — a plain hosts
// file has no concept of that, it can only block or allow an entire
// domain).
const BLOCKED_HOSTS = [
  // Google ads/analytics/tag-management (NOT google.com/accounts.google.com
  // etc. — those stay reachable, this is only the ad-tech subset)
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "google-analytics.com",
  "googletagmanager.com",
  "googletagservices.com",
  "adservice.google.com",
  "2mdn.net", // DoubleClick's own static-asset/creative CDN
  "pagead2.googlesyndication.com",
  // Meta/Facebook tracking pixel + SDK (facebook.com itself stays reachable)
  "connect.facebook.net",
  "facebook.com/tr",
  // Other major ad/tracking networks
  "adnxs.com",
  "scorecardresearch.com",
  "quantserve.com",
  "hotjar.com",
  "criteo.com",
  "criteo.net",
  "outbrain.com",
  "taboola.com",
  "amazon-adsystem.com",
  "adsrvr.org",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "bluekai.com",
  "mathtag.com",
  "moatads.com",
  "yandex.ru/metrika",
  "mc.yandex.ru",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "fullstory.com",
  "clarity.ms",
  "bing.com/bat.js",
  // Real display/video ad-serving networks — the actual visible-ads half,
  // as opposed to the mostly analytics/tracking list above. Added after a
  // "the Ad-Blocker doesn't work" report: the original list blocked most
  // TRACKING pixels well, but left plenty of banner/video ad creatives
  // still loading from networks that were never on it. See also
  // tab-manager.ts's Ad-Blocker cosmetic CSS, which hides the (now empty)
  // ad containers these leave behind.
  "adform.net",
  "advertising.com",
  "casalemedia.com",
  "contextweb.com",
  "indexexchange.com",
  "smartadserver.com",
  "media.net",
  "mgid.com",
  "revcontent.com",
  "adroll.com",
  "bidswitch.net",
  "yieldmo.com",
  "sharethrough.com",
  "sovrn.com",
  "adsafeprotected.com",
  "serving-sys.com",
  "adtechus.com",
  "33across.com",
  "gumgum.com",
  "sspinc.com",
  "spotxchange.com",
  "springserve.com",
  "teads.tv",
];

function hostMatches(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    if (isInBundledAdBlockList(hostname)) return true;
    return BLOCKED_HOSTS.some((entry) => {
      const [host, pathPrefix] = entry.split("/", 2);
      if (hostname !== host && !hostname.endsWith(`.${host}`)) return false;
      if (!pathPrefix) return true;
      return pathname.startsWith(`/${pathPrefix}`);
    });
  } catch {
    return false;
  }
}

// Control center's per-site "X off for this site" toggles — resolves
// which domain a given request should be checked against. For a
// sub-resource (script, image, xhr, iframe, ...) that's the ISSUING
// PAGE's domain, via the webContents' current top-level URL (a tracker
// script is basically never on the same domain as the site loading it) —
// same way site-permissions-store.ts's checks already do. For a
// mainFrame request itself, webContents.getURL() would still return the
// PREVIOUS page (the navigation hasn't committed yet), so that case uses
// the request's own URL instead — the address being navigated TO, which
// is what a per-site cookie exception actually needs to key off of.
function resolveRequestDomain(details: {
  resourceType: string;
  url: string;
  webContentsId: number;
}): string | null {
  try {
    if (details.resourceType === "mainFrame") return new URL(details.url).hostname;
    const wc = webContents.fromId(details.webContentsId);
    return wc ? new URL(wc.getURL()).hostname : null;
  } catch {
    return null;
  }
}

function isFeatureDisabledForRequest(
  feature: SiteOverridableFeature,
  details: { resourceType: string; url: string; webContentsId: number },
): boolean {
  const domain = resolveRequestDomain(details);
  return domain !== null && isFeatureDisabledForDomain(feature, domain);
}

// Built once at module load, not per-request — see adblock-domains.ts's
// own header for what this list is and how to refresh it.
const BUNDLED_AD_BLOCK_SET = new Set(BUNDLED_AD_BLOCK_DOMAINS);

// Walks a hostname up through its parent domains
// ("ads.sub.example.com" -> "sub.example.com" -> "example.com" -> "com"),
// checking each level against the bundled set — same "exact match, or a
// listed domain is a suffix" semantics as BLOCKED_HOSTS' endsWith check
// above, just done as a handful of O(1) Set lookups instead of a linear
// scan. That distinction actually matters at this list's size (80,000+
// entries, versus BLOCKED_HOSTS' ~90) — a .some()/endsWith scan over the
// whole thing on every single request would be real, visible per-request
// overhead; walking at most a few dot-separated labels per request isn't.
function isInBundledAdBlockList(hostname: string): boolean {
  let h = hostname;
  while (h) {
    if (BUNDLED_AD_BLOCK_SET.has(h)) return true;
    const dot = h.indexOf(".");
    if (dot === -1) return false;
    h = h.slice(dot + 1);
  }
  return false;
}

// For Zora's list_trackers_on_page tool — just the hostname, for a short
// human-readable name (e.g. "doubleclick.net"), not the full blocked URL
// with tracking params attached.
function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

// Masterplan #33 — user-supplied patterns (only "*" as a wildcard, same
// pragmatic scope as request-mocks-store.ts's matcher), checked against
// the full URL rather than just the hostname so a pattern like
// "*.example.com/api/*" can target a specific path too.
function matchesCustomPattern(url: string): boolean {
  const patterns = customBlockedPatternsSetting();
  if (patterns.length === 0) return false;
  return patterns.some((pattern) => {
    if (!pattern.trim()) return false;
    const regex = new RegExp(
      "^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    );
    return regex.test(url);
  });
}

export function applyPrivacyHardening(targetSession?: Electron.Session) {
  const ses = targetSession ?? electronSession.defaultSession;

  // --- Tracker/ad blocking -------------------------------------------
  // Gated by the Control center's "Add-Blocker" toggle (default on, so
  // behavior is unchanged for anyone who never opens it).
  console.log("[ad-block] hook registered, adBlockEnabled() =", adBlockEnabled());
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Masterplan #26 — start time for this request's log entry (see the
    // onCompleted hook below), recorded unconditionally so the log covers
    // every request, not just ones any of the toggles below act on.
    recordRequestStart(details.id, details.timestamp);
    // mainFrame is excluded here on purpose: that's not a tracker loading
    // inside a page, it's the actual navigation — the address the person
    // is going TO. A lot of "click a sponsored search result" links (Google/
    // Bing/DS ad redirects, e.g. ad.doubleclick.net/searchads/.../click?
    // ...&ds_dest_url=<the real site>) live on domains that are correctly
    // blocklisted as trackers, since the same domains also serve actual ad
    // creatives/beacons as sub-resources. But cancelling THIS request — the
    // navigation itself — doesn't stop an ad from loading, it just strands
    // the person on the "Blocked by the Ad-Blocker" page with no way to
    // reach the site they clicked through to. Sub-resource trackers
    // (scripts, images, iframes, xhr) a page pulls in on its own are still
    // blocked exactly as before.
    if (
      adBlockEnabled() &&
      details.resourceType !== "mainFrame" &&
      hostMatches(details.url) &&
      !isFeatureDisabledForRequest("adBlock", details)
    ) {
      // Control center's "Tracker-Zähler" — every cancelled request here
      // IS a blocked tracker by definition (hostMatches only matches
      // BLOCKED_HOSTS), so counting it right at the point of cancellation
      // needs no extra classification logic. details.webContentsId is
      // whichever tab's page issued the request, not necessarily the
      // active one.
      console.log("[ad-block] blocked", details.url);
      incrementTrackerCount(details.webContentsId, safeHostname(details.url));
      callback({ cancel: true });
      return;
    }
    // Masterplan #33 — user-defined block patterns, same cancellation
    // path as the built-in ad blocker above but driven by the person's
    // own list instead of BLOCKED_HOSTS.
    if (matchesCustomPattern(details.url)) {
      callback({ cancel: true });
      return;
    }
    // Masterplan #34 — Request-Interception/Mocking. Checked before the
    // image-blocking/HTTPS-upgrade logic below since a mocked request
    // should never actually go out at all. redirectURL to a data: URI is
    // the simplest way to substitute a full response body without
    // needing Electron's lower-level protocol.interceptBufferProtocol
    // (which requires registering the interception at session-creation
    // time) — sufficient for the JSON/text API-testing case this feature
    // targets, though unlike a real interception it can't set custom
    // response headers or an arbitrary status code on the actual network
    // layer (the body substitution is what matters for most API mocking).
    const mock = findMatchingMock(details.url);
    if (mock) {
      const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(mock.body);
      callback({ redirectURL: dataUri });
      return;
    }
    // Control center's "Disable images" — a plain data-saver mode,
    // cancels every image sub-resource regardless of host. Checked here
    // (same hook as the ad-blocker above) rather than a separate
    // onBeforeRequest listener, since Electron dispatches multiple
    // listeners on the same event in registration order anyway — no
    // benefit to splitting this into its own hook.
    if (
      imagesGloballyDisabled() &&
      details.resourceType === "image" &&
      !isFeatureDisabledForRequest("images", details)
    ) {
      callback({ cancel: true });
      return;
    }
    // Best-effort HTTPS upgrade for top-level navigations only — never
    // for sub-resources (an image or script silently switching protocol
    // makes a broken mixed-content page much harder to debug than a
    // page that just loads over http). If the site doesn't actually
    // support https, the existing did-fail-load handler in
    // tab-manager.ts already surfaces a normal "page not available"
    // instead of hanging.
    //
    // Root cause of the whole app going blank white: this ran against
    // EVERY mainFrame http:// request, including the chrome UI's own —
    // it's served locally over plain http (either the vite dev server at
    // http://localhost:8080, or the bundled production server at
    // http://127.0.0.1:<port>, see ensureProductionServer() in main.ts),
    // and neither actually speaks https. Redirecting THAT to https just
    // hangs on a connection nothing answers, and the app never gets
    // anything to render. localhost/127.0.0.1 (any port) are excluded —
    // they're never a real public site, only ever this app's own UI.
    const isLocalAppServer = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(details.url);
    if (!isLocalAppServer && details.resourceType === "mainFrame" && details.url.startsWith("http://") && !consumeHttpExemption(details.url)) {
      const upgraded = "https://" + details.url.slice("http://".length);
      recordHttpsUpgrade(upgraded, details.url);
      callback({ redirectURL: upgraded });
      return;
    }
    callback({});
  });

  // --- Bandwidth counter -----------------------------------------------
  // Control center's "Bandbreiten-Nutzung" (masterplan #10) — sums the
  // Content-Length of every completed response per tab. Reading it off
  // onCompleted's own responseHeaders (rather than a separate
  // onHeadersReceived listener) keeps this to one extra hook, in the same
  // spot every other webRequest-based counter here already lives.
  ses.webRequest.onCompleted((details) => {
    const headers = details.responseHeaders;
    if (headers) {
      // Header casing isn't guaranteed — Electron passes through whatever
      // the server sent, so check both.
      const raw = headers["Content-Length"] ?? headers["content-length"];
      const value = Array.isArray(raw) ? raw[0] : raw;
      const bytes = value ? parseInt(value, 10) : NaN;
      if (!Number.isNaN(bytes)) addBandwidthBytes(details.webContentsId, bytes);
    }
    // Masterplan #26 — every completed request becomes one log entry,
    // regardless of resourceType (mainFrame navigations included, same as
    // a real DevTools Network panel).
    recordRequestCompleted(details.webContentsId, details.id, {
      url: details.url,
      method: details.method,
      statusCode: details.statusCode,
      timestamp: details.timestamp,
    });
  });

  // --- Do-Not-Track + trimmed cross-site Referer ----------------------
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (doNotTrackEnabled()) headers["DNT"] = "1";
    // Control center's "Cookies blockieren" — strips any outgoing Cookie
    // header entirely rather than trying to distinguish first/third-party
    // here (that distinction needs details.resourceType + the frame's own
    // top-level origin, which isn't reliably available at this hook for
    // every request type) — the simple, honest version of "block cookies".
    // Per-site exception: resolveRequestDomain handles the mainFrame case
    // itself (the site being navigated TO, not the previous page), so a
    // domain someone's exempted keeps its cookies on the very navigation
    // that loads it, not just on sub-resources after the fact.
    if (cookiesBlocked() && !isFeatureDisabledForRequest("cookies", details)) {
      delete headers["Cookie"];
    }
    // NOTE: we deliberately do NOT trim the Referer ourselves anymore.
    // Chromium already defaults every navigation to "strict-origin-when-
    // cross-origin" (has since Chrome 85) and — crucially — honors a
    // page's own Referrer-Policy header/meta tag when it explicitly wants
    // to send more than that (e.g. a full path for anti-hotlink/download
    // verification, like AMD's driver downloads, which reject the request
    // outright if the referrer gets cut down to just the origin). Forcing
    // our own trim here overrode that and broke exactly those downloads.
    // The Chromium default already gives the same privacy protection for
    // every site that doesn't explicitly opt for something looser.
    callback({ requestHeaders: headers });
  });

  // Strips incoming Set-Cookie response headers too — stopping the
  // OUTGOING Cookie header alone still lets a site set/refresh cookies
  // that would go out on the person's very next request.
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!cookiesBlocked() || isFeatureDisabledForRequest("cookies", details)) {
      callback({});
      return;
    }
    const headers = { ...details.responseHeaders };
    delete headers["set-cookie"];
    delete headers["Set-Cookie"];
    callback({ responseHeaders: headers });
  });

  // --- WebRTC IP leak protection --------------------------------------
  // Without this, a page's WebRTC code can enumerate real local/public
  // IPs via ICE candidates even while a VPN/proxy is active — one of the
  // most common ways a "private" browsing setup leaks the real address
  // anyway. This restricts ICE gathering to whatever the OS default
  // route already exposes, no direct-UDP probing.
  //
  // ses.setWebRTCIPHandlingPolicy() — what this used to call — was removed
  // from Electron's Session API entirely (crashed the whole main process
  // with "not a function" here, since applyPrivacyHardening() runs inside
  // an unhandled promise). The actual effect now has to be set as a raw
  // Chromium command-line switch instead — see applyEarlyPrivacySwitches()
  // below, which MUST run before app.whenReady() (a switch set any later
  // than that is simply ignored by Chromium).

  // --- Permission hardening --------------------------------------------
  // Per-domain now (see Settings → Privacy → Site permissions) instead of
  // a blanket "always denied" — falls back to denied (and records that
  // denial so it shows up in Settings as an already-decided site) for any
  // domain with no stored decision yet, and for permission kinds this app
  // doesn't have a dedicated toggle for (geolocation, MIDI, HID, ...) —
  // those stay hardcoded-denied regardless, there's no UI for them.
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    // The Fullscreen API (a video player's fullscreen button, etc.) isn't
    // a privacy-sensitive permission the way camera/mic/geolocation are —
    // it's "let this page fill the window", nothing it can spy with. It
    // has no per-site toggle in Settings either. Without this early
    // allow, it fell through to the same "no stored decision → denied"
    // path as everything else below, which silently killed every
    // fullscreen request before enter-html-full-screen ever got a chance
    // to fire — the actual cause of fullscreen doing nothing on real
    // pages.
    if (permission === "fullscreen") {
      callback(true);
      return;
    }
    // Sanitized clipboard WRITE (navigator.clipboard.writeText/write with a
    // user gesture) is what every real browser allows silently, no prompt —
    // it's the "copy" button case, not a privacy-sensitive read. Without
    // this, it fell through to the same "no stored decision → denied" path
    // as camera/mic, which is why copy buttons did nothing on every real
    // site (including our own). Clipboard READ stays out of this allowlist
    // and keeps falling through to denied below — actually letting a page
    // read the clipboard is the sensitive direction.
    if (permission === "clipboard-sanitized-write") {
      callback(true);
      return;
    }
    // Pointer Lock (element.requestPointerLock() — mouselook in browser
    // games, 3D viewers/CAD tools, any canvas app that captures the
    // cursor) isn't privacy-sensitive either, same reasoning as fullscreen
    // above — it doesn't hand the page any data, just cursor capture, and
    // Chromium already shows its own "press Esc to exit" overlay for it.
    // Same missing-mapping problem as clipboard write: silently denied,
    // looked exactly like "the game just doesn't respond to my mouse".
    if (permission === "pointerLock") {
      callback(true);
      return;
    }
    // geolocation has no per-site store entry (see PERMISSION_KIND_MAP's
    // comment) — it's governed entirely by the Control center's
    // "Standortfreigabe global" toggle, defaulting to blocked (the
    // app's original hardcoded behavior).
    if (permission === "geolocation") {
      callback(!locationGloballyBlocked());
      return;
    }
    const kind = PERMISSION_KIND_MAP[permission];
    const win = BrowserWindow.fromWebContents(webContents);
    if (!kind || !win) {
      callback(false);
      return;
    }
    // Control center's "Kamera/Mikrofon global" toggles override any
    // per-site "allow" a person may have granted earlier — a hard kill
    // switch, not just a different default.
    if (kind === "camera" && cameraGloballyBlocked()) {
      callback(false);
      return;
    }
    if (kind === "microphone" && micGloballyBlocked()) {
      callback(false);
      return;
    }
    // Control center's "Nicht stören" — same hard-override shape as the
    // camera/mic global blocks above: wins over any per-site "allow" a
    // person may have granted earlier, rather than just changing the
    // default for undecided sites.
    if (kind === "notifications" && doNotDisturbEnabled()) {
      callback(false);
      return;
    }
    let domain: string;
    try {
      domain = new URL(webContents.getURL()).hostname;
    } catch {
      callback(false);
      return;
    }
    const entry = getSitePermission(win.id, domain);
    if (!entry) {
      recordDefaultBlock(win.id, domain, kind);
      callback(false);
      return;
    }
    callback(entry[kind] === "allow");
  });
  ses.setPermissionCheckHandler((webContents, permission) => {
    if (permission === "fullscreen") return true;
    if (permission === "clipboard-sanitized-write") return true;
    if (permission === "pointerLock") return true;
    if (permission === "geolocation") return !locationGloballyBlocked();
    const kind = PERMISSION_KIND_MAP[permission];
    const win = webContents ? BrowserWindow.fromWebContents(webContents) : null;
    if (!kind || !win) return false;
    if (kind === "camera" && cameraGloballyBlocked()) return false;
    if (kind === "microphone" && micGloballyBlocked()) return false;
    if (kind === "notifications" && doNotDisturbEnabled()) return false;
    try {
      const domain = new URL(webContents!.getURL()).hostname;
      return getSitePermission(win.id, domain)?.[kind] === "allow";
    } catch {
      return false;
    }
  });
}

// Electron's permission-name strings (varies by request type) mapped to
// this app's four user-facing kinds — see site-permissions-store.ts.
// Anything not in this map (geolocation, midi, hid, serial, ...) always
// falls through to denied above, same as before this feature existed.
const PERMISSION_KIND_MAP: Record<string, PermissionKind | undefined> = {
  media: "camera", // Electron doesn't distinguish audio/video-only requests at this layer
  camera: "camera",
  microphone: "microphone",
  notifications: "notifications",
};

const DOH_TEMPLATES: Record<string, string> = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  quad9: "https://dns.quad9.net/dns-query",
  google: "https://dns.google/dns-query",
};

// Call once, at the very top of main.ts, BEFORE app.whenReady() — Chromium
// only reads command-line switches during its own startup, so this is the
// one place the WebRTC IP-leak protection above (now that the direct
// session API for it is gone, see applyPrivacyHardening) can still be set.
// Also where DNS-over-HTTPS gets turned on — same "startup-only switch"
// constraint applies, which is why changing the provider in Settings
// needs a restart to actually take effect (there's no live-session API
// for this the way there is for most other things here).
export function applyEarlyPrivacySwitches() {
  // Control center's "WebRTC-Schutz" — was previously always on
  // unconditionally; now gated by the toggle (defaults to true, so
  // behavior is unchanged for anyone who never opens it), same
  // "Restart" constraint as everything else in this function.
  if (getControlCenterSettings().webrtcLeakProtection) {
    app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
  }
  const provider = getPrivacySettings().dohProvider;
  if (provider !== "off" && DOH_TEMPLATES[provider]) {
    app.commandLine.appendSwitch("enable-features", "DnsOverHttps");
    app.commandLine.appendSwitch("dns-over-https-mode", "secure"); // "secure", not "automatic" — refuses to silently fall back to plain DNS if the DoH resolver is unreachable
    app.commandLine.appendSwitch("dns-over-https-templates", DOH_TEMPLATES[provider]);
  }
  // Control center's "Disable preload/prefetch" — Chromium's own
  // predictive-networking features (DNS prefetch, preconnect, prerender)
  // are only configurable via startup switches, same constraint as the
  // two above: a change here needs a relaunch to take effect, which is
  // why this field carries a "Restart" badge in the UI.
  if (getControlCenterSettings().preloadDisabled) {
    app.commandLine.appendSwitch(
      "disable-features",
      "NetworkPrediction,PreloadDnsHttpsRecords,PrerenderCore",
    );
  }
}

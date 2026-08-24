import { app, session as electronSession, BrowserWindow } from "electron";
import { getSitePermission, recordDefaultBlock, type PermissionKind } from "./site-permissions-store";
import { recordHttpsUpgrade, consumeHttpExemption } from "./https-upgrade-tracker";
import { getPrivacySettings } from "./privacy-settings-store";
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

// A compact, high-signal list of ad/tracking hosts. Deliberately NOT
// exhaustive (a full EasyList/EasyPrivacy list is tens of thousands of
// entries and needs its own updater) — this covers the networks that
// account for the large majority of cross-site tracking, while staying
// small enough to reason about and keep in the repo.
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
];

function hostMatches(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
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
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Masterplan #26 — start time for this request's log entry (see the
    // onCompleted hook below), recorded unconditionally so the log covers
    // every request, not just ones any of the toggles below act on.
    recordRequestStart(details.id, details.timestamp);
    if (adBlockEnabled() && hostMatches(details.url)) {
      // Control center's "Tracker-Zähler" — every cancelled request here
      // IS a blocked tracker by definition (hostMatches only matches
      // BLOCKED_HOSTS), so counting it right at the point of cancellation
      // needs no extra classification logic. details.webContentsId is
      // whichever tab's page issued the request, not necessarily the
      // active one.
      incrementTrackerCount(details.webContentsId);
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
    // Control center's "Bilder deaktivieren" — a plain data-saver mode,
    // cancels every image sub-resource regardless of host. Checked here
    // (same hook as the ad-blocker above) rather than a separate
    // onBeforeRequest listener, since Electron dispatches multiple
    // listeners on the same event in registration order anyway — no
    // benefit to splitting this into its own hook.
    if (imagesGloballyDisabled() && details.resourceType === "image") {
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
    if (cookiesBlocked()) delete headers["Cookie"];
    // Cuts a cross-site Referer down to just the origin (path/query
    // dropped) — matches browsers' "strict-origin-when-cross-origin"
    // default, so a link out to another site no longer hands it your
    // exact page URL, only which site you came from.
    const referer = headers["Referer"];
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        const targetUrl = new URL(details.url);
        if (refererUrl.origin !== targetUrl.origin) {
          headers["Referer"] = refererUrl.origin + "/";
        }
      } catch {
        /* malformed Referer — leave it alone */
      }
    }
    callback({ requestHeaders: headers });
  });

  // Strips incoming Set-Cookie response headers too — stopping the
  // OUTGOING Cookie header alone still lets a site set/refresh cookies
  // that would go out on the person's very next request.
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!cookiesBlocked()) {
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
  // Control center's "Preload/Prefetch deaktivieren" — Chromium's own
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

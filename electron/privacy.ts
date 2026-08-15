import { app, session as electronSession, BrowserWindow } from "electron";
import { getSitePermission, recordDefaultBlock, type PermissionKind } from "./site-permissions-store";
import { recordHttpsUpgrade, consumeHttpExemption } from "./https-upgrade-tracker";
import { getPrivacySettings } from "./privacy-settings-store";

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

export function applyPrivacyHardening(targetSession?: Electron.Session) {
  const ses = targetSession ?? electronSession.defaultSession;

  // --- Tracker/ad blocking -------------------------------------------
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (hostMatches(details.url)) {
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

  // --- Do-Not-Track + trimmed cross-site Referer ----------------------
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    headers["DNT"] = "1";
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
    const kind = PERMISSION_KIND_MAP[permission];
    const win = BrowserWindow.fromWebContents(webContents);
    if (!kind || !win) {
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
    const kind = PERMISSION_KIND_MAP[permission];
    const win = webContents ? BrowserWindow.fromWebContents(webContents) : null;
    if (!kind || !win) return false;
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
  app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
  const provider = getPrivacySettings().dohProvider;
  if (provider !== "off" && DOH_TEMPLATES[provider]) {
    app.commandLine.appendSwitch("enable-features", "DnsOverHttps");
    app.commandLine.appendSwitch("dns-over-https-mode", "secure"); // "secure", not "automatic" — refuses to silently fall back to plain DNS if the DoH resolver is unreachable
    app.commandLine.appendSwitch("dns-over-https-templates", DOH_TEMPLATES[provider]);
  }
}

import { JsonStore } from "./json-store";

// Global (not per-profile) settings for the new top-left "Control center"
// dropdown (replaces the old chevron/tabsMenu button — see
// ControlCenterContent.tsx). Kept in its own store/file rather than
// folded into privacy-settings-store.ts because most of these are plain
// browser-behavior toggles, not strictly privacy/security posture, and
// because one of them (hardwareAcceleration) only takes effect on the
// NEXT app launch — worth being able to reason about as a separate,
// self-contained group.
//
// Every field here is intentionally a dumb, serializable value — the
// actual *effect* of flipping one lives in privacy.ts (webRequest/
// permission hooks), tab-manager.ts (per-webContents behavior) or main.ts
// (startup switches), never here. This file only persists the choice.
export type NetworkThrottlePreset = "off" | "slow3g" | "fast3g" | "offline" | "custom";
export type DohProviderChoice = "cloudflare" | "quad9" | "google";
export type VisionFilter = "none" | "high-contrast" | "protanopia" | "deuteranopia" | "tritanopia";
export type CursorSize = "default" | "large" | "xlarge";
export type UserAgentPreset = "default" | "chrome-win" | "safari-ios" | "firefox-linux";

export type ControlCenterSettings = {
  // --- network / content ---------------------------------------------
  adBlockEnabled: boolean;
  javascriptDisabled: boolean;
  cookiesBlocked: boolean;
  doNotTrack: boolean;
  autoplayBlock: boolean; // per-tab webPreferences.autoplayPolicy, see tab-manager.ts's createTab()
  popupBlock: boolean;
  networkThrottle: NetworkThrottlePreset;
  // Masterplan #35 — only read when networkThrottle === "custom", see
  // tab-manager.ts's setNetworkThrottle.
  customDownloadKbps: number;
  customUploadKbps: number;
  customLatencyMs: number;
  dnsOverHttpsEnabled: boolean; // mirrors privacy-settings-store's dohProvider (off <-> chosen provider)
  dnsOverHttpsProvider: DohProviderChoice; // which provider to use once dnsOverHttpsEnabled is on
  // Masterplan #33 — plain substring/wildcard patterns, matched the same
  // way as BLOCKED_HOSTS in privacy.ts but user-supplied.
  customBlockedPatterns: string[];
  // --- permissions ------------------------------------------------------
  cameraGlobalBlock: boolean;
  micGlobalBlock: boolean;
  locationGlobalBlock: boolean;
  // --- vpn ----------------------------------------------------------
  vpnEnabled: boolean; // mirrors tor-manager's start/stop
  vpnKillSwitch: boolean; // blocks all traffic in a Tor window if Tor disconnects mid-session, see main.ts's createTorWindow
  // --- performance --------------------------------------------------
  unloadBackgroundTabsOnIdle: boolean;
  autoSuspendMinutes: number; // 0 = off; minutes a background tab must sit idle before tab-manager.ts auto-unloads it, see its checkAutoSuspend()
  backgroundTabsThrottled: boolean;
  hardwareAcceleration: boolean; // app.disableHardwareAcceleration(), needs a relaunch to apply
  imagesDisabled: boolean; // blocks resourceType "image" requests, see privacy.ts
  preloadDisabled: boolean; // disables Chromium's predictive prefetch/preconnect, needs a relaunch to apply
  batterySaverMode: boolean; // preset: forces backgroundTabsThrottled + unloadBackgroundTabsOnIdle on
  // --- display --------------------------------------------------------
  masterMute: boolean;
  darkModeForced: boolean;
  globalZoomFactor: number; // reuses TabManager.setDefaultZoom
  visionFilter: VisionFilter; // CSS filter applied to every tab, see tab-manager.ts's setVisionFilter
  cursorSize: CursorSize; // CSS cursor override applied to every tab
  gridOverlayEnabled: boolean; // fixed alignment grid injected into every tab, see tab-manager.ts's setGridOverlay
  userAgentPreset: UserAgentPreset; // spoofed User-Agent applied to every tab, see tab-manager.ts's setUserAgentPreset
  // --- focus ----------------------------------------------------------
  focusMode: boolean; // purely a renderer-side UI state, but persisted here so it survives restarts
  doNotDisturb: boolean; // global override on top of per-site "notifications" permission, see privacy.ts
  // --- privacy & security ----------------------------------------------
  webrtcLeakProtection: boolean; // gates the "force-webrtc-ip-handling-policy" startup switch, see privacy.ts's applyEarlyPrivacySwitches. Needs a relaunch to apply.
  httpsOnlyEnforced: boolean; // mirrors privacy-settings-store's httpsOnly (same "toggle here drives the real setting" pattern as dnsOverHttpsEnabled/dohProvider above)
  cookieAutoDelete: boolean; // clears a domain's cookies once its last open tab closes, see tab-manager.ts's closeTab
  // --- devtools ---------------------------------------------------------
  jsErrorOverlayEnabled: boolean; // masterplan #28 — on-page red error banner on an uncaught console error, see tab-manager.ts's trackConsoleErrors
};

export const CONTROL_CENTER_DEFAULTS: ControlCenterSettings = {
  adBlockEnabled: true,
  javascriptDisabled: false,
  cookiesBlocked: false,
  doNotTrack: true,
  autoplayBlock: false,
  popupBlock: true,
  networkThrottle: "off",
  customDownloadKbps: 1500,
  customUploadKbps: 750,
  customLatencyMs: 100,
  dnsOverHttpsEnabled: false,
  dnsOverHttpsProvider: "cloudflare",
  customBlockedPatterns: [],
  cameraGlobalBlock: false,
  micGlobalBlock: false,
  locationGlobalBlock: true, // matches this app's existing hardcoded-denied geolocation behavior
  vpnEnabled: false,
  vpnKillSwitch: false,
  unloadBackgroundTabsOnIdle: false,
  autoSuspendMinutes: 0,
  backgroundTabsThrottled: true,
  hardwareAcceleration: true,
  imagesDisabled: false,
  preloadDisabled: false,
  batterySaverMode: false,
  masterMute: false,
  darkModeForced: false,
  globalZoomFactor: 1,
  visionFilter: "none",
  cursorSize: "default",
  gridOverlayEnabled: false,
  userAgentPreset: "default",
  focusMode: false,
  doNotDisturb: false,
  webrtcLeakProtection: true, // matches this app's existing hardcoded-on WebRTC leak protection
  httpsOnlyEnforced: false,
  cookieAutoDelete: false,
  jsErrorOverlayEnabled: false,
};

export type DeviceEmulationPreset = "off" | "iphone14" | "ipad" | "desktop-sm";

export type ControlCenterActionType =
  | "openDevTools"
  | "reloadNoCache"
  | "clearCache"
  | "screenshot"
  | "printPdf"
  | "print"
  | "unloadTab"
  | "unloadAllBackgroundTabs"
  | "setNetworkThrottle"
  | "savePageAs"
  | "translatePage"
  | "forcePip"
  | "pauseAllMedia"
  | "muteAllMedia"
  | "toggleReaderMode"
  | "setCustomCss"
  | "fullPageScreenshot"
  | "exportPageAsMarkdown"
  | "getPageMetadata"
  | "setDeviceEmulation"
  | "startElementPicker"
  | "getRequestLog"
  | "exportConsoleLog"
  | "getCookiesForTab"
  | "setCookie"
  | "deleteCookie"
  | "getIndexedDbInfo"
  | "getServiceWorkerStatus"
  | "unregisterServiceWorkers"
  | "toggleHarRecording"
  | "setRequestMock"
  | "deleteRequestMock"
  | "getRequestMocks";

export type PageMetadata = {
  title: string;
  titleLength: number;
  description: string | null;
  canonicalUrl: string | null;
  ogTags: { property: string; content: string }[];
};

export type RequestLogEntry = {
  url: string;
  method: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
};

export type CookieEntry = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate: number | null;
};

export type IndexedDbInfo = {
  databases: { name: string; objectStores: string[] }[];
};

export type ServiceWorkerInfo = {
  registrations: { scope: string; scriptURL: string; active: boolean }[];
};

export type RequestMock = { pattern: string; status: number; body: string };

export type ControlCenterActionRequest =
  | {
      type: Exclude<
        ControlCenterActionType,
        | "setNetworkThrottle"
        | "translatePage"
        | "muteAllMedia"
        | "setCustomCss"
        | "setDeviceEmulation"
        | "setCookie"
        | "deleteCookie"
        | "setRequestMock"
        | "deleteRequestMock"
      >;
      tabId?: string;
    }
  | { type: "setNetworkThrottle"; tabId?: string; preset: NetworkThrottlePreset }
  | { type: "translatePage"; tabId?: string; langCode: string }
  | { type: "muteAllMedia"; muted: boolean }
  | { type: "setCustomCss"; tabId?: string; domain: string; css: string }
  | { type: "setDeviceEmulation"; tabId?: string; preset: DeviceEmulationPreset }
  | { type: "setCookie"; tabId?: string; name: string; value: string }
  | { type: "deleteCookie"; tabId?: string; name: string }
  | { type: "setRequestMock"; pattern: string; status: number; body: string }
  | { type: "deleteRequestMock"; pattern: string };

const store = new JsonStore<ControlCenterSettings>("control-center-settings.json");

export function getControlCenterSettings(): ControlCenterSettings {
  return { ...CONTROL_CENTER_DEFAULTS, ...store.read(CONTROL_CENTER_DEFAULTS) };
}

export function setControlCenterSettings(
  patch: Partial<ControlCenterSettings>,
): ControlCenterSettings {
  const next = { ...getControlCenterSettings(), ...patch };
  store.write(next);
  return next;
}

// Cheap accessors for the hot paths checked on every request/tab-create,
// same pattern as privacy-settings-store.ts's trackingParamsEnabled() etc.
export function adBlockEnabled(): boolean {
  return getControlCenterSettings().adBlockEnabled;
}
export function doNotTrackEnabled(): boolean {
  return getControlCenterSettings().doNotTrack;
}
export function cookiesBlocked(): boolean {
  return getControlCenterSettings().cookiesBlocked;
}
export function popupBlockEnabled(): boolean {
  return getControlCenterSettings().popupBlock;
}
// Read live now (not just once at startup) — see tab-manager.ts's
// createTab(), which sets webPreferences.autoplayPolicy per tab instead
// of the old app-wide command-line switch.
export function autoplayBlockEnabled(): boolean {
  return getControlCenterSettings().autoplayBlock;
}
export function cameraGloballyBlocked(): boolean {
  return getControlCenterSettings().cameraGlobalBlock;
}
export function micGloballyBlocked(): boolean {
  return getControlCenterSettings().micGlobalBlock;
}
export function locationGloballyBlocked(): boolean {
  return getControlCenterSettings().locationGlobalBlock;
}
export function imagesGloballyDisabled(): boolean {
  return getControlCenterSettings().imagesDisabled;
}
export function doNotDisturbEnabled(): boolean {
  return getControlCenterSettings().doNotDisturb;
}
export function webrtcLeakProtectionEnabled(): boolean {
  return getControlCenterSettings().webrtcLeakProtection;
}
export function cookieAutoDeleteEnabled(): boolean {
  return getControlCenterSettings().cookieAutoDelete;
}
export function vpnKillSwitchEnabled(): boolean {
  return getControlCenterSettings().vpnKillSwitch;
}
export function autoSuspendMinutesSetting(): number {
  return getControlCenterSettings().autoSuspendMinutes;
}
export function jsErrorOverlayEnabled(): boolean {
  return getControlCenterSettings().jsErrorOverlayEnabled;
}
export function customBlockedPatternsSetting(): string[] {
  return getControlCenterSettings().customBlockedPatterns;
}

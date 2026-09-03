import { useCallback, useEffect, useState } from "react";
import type { SiteOverridableFeature } from "./use-browser-api";

// Renderer-side copy of electron/control-center-store.ts's types — same
// pattern as use-privacy-settings.ts.
export type NetworkThrottlePreset = "off" | "slow3g" | "fast3g" | "offline" | "custom";
export type DohProviderChoice = "cloudflare" | "quad9" | "google";
export type VisionFilter = "none" | "high-contrast" | "protanopia" | "deuteranopia" | "tritanopia";
export type CursorSize = "default" | "large" | "xlarge";
export type UserAgentPreset = "default" | "chrome-win" | "safari-ios" | "firefox-linux";

export type ControlCenterSettings = {
  adBlockEnabled: boolean;
  javascriptDisabled: boolean;
  cookiesBlocked: boolean;
  doNotTrack: boolean;
  autoplayBlock: boolean;
  popupBlock: boolean;
  networkThrottle: NetworkThrottlePreset;
  customDownloadKbps: number;
  customUploadKbps: number;
  customLatencyMs: number;
  dnsOverHttpsEnabled: boolean;
  dnsOverHttpsProvider: DohProviderChoice;
  customBlockedPatterns: string[];
  cameraGlobalBlock: boolean;
  micGlobalBlock: boolean;
  locationGlobalBlock: boolean;
  vpnEnabled: boolean;
  vpnKillSwitch: boolean;
  unloadBackgroundTabsOnIdle: boolean;
  autoSuspendMinutes: number;
  backgroundTabsThrottled: boolean;
  hardwareAcceleration: boolean;
  imagesDisabled: boolean;
  preloadDisabled: boolean;
  batterySaverMode: boolean;
  masterMute: boolean;
  darkModeForced: boolean;
  globalZoomFactor: number;
  visionFilter: VisionFilter;
  cursorSize: CursorSize;
  gridOverlayEnabled: boolean;
  focusMode: boolean;
  doNotDisturb: boolean;
  userAgentPreset: UserAgentPreset;
  webrtcLeakProtection: boolean;
  httpsOnlyEnforced: boolean;
  cookieAutoDelete: boolean;
  jsErrorOverlayEnabled: boolean;
};

export type DeviceEmulationPreset = "off" | "iphone14" | "ipad" | "desktop-sm";

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
  | "getRequestMocks"
  | "setSiteFeatureOverride";

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
        | "setSiteFeatureOverride"
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
  | { type: "deleteRequestMock"; pattern: string }
  | {
      type: "setSiteFeatureOverride";
      tabId?: string;
      feature: SiteOverridableFeature;
      domain: string;
      disabled: boolean;
    };

const DEFAULTS: ControlCenterSettings = {
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
  locationGlobalBlock: true,
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
  focusMode: false,
  doNotDisturb: false,
  userAgentPreset: "default",
  webrtcLeakProtection: true,
  httpsOnlyEnforced: false,
  cookieAutoDelete: false,
  jsErrorOverlayEnabled: false,
};

// Lives in the MAIN window only (mirrors use-privacy-settings.ts) — the
// overlay window that actually renders ControlCenterContent has no direct
// IPC access to controlCenter:*, it only reports what the person clicked
// via notifyAction (see routes/index.tsx's "tabsMenu" action handler,
// which calls update()/runAction() from here in response).
export function useControlCenter() {
  const api = typeof window !== "undefined" ? window.browserAPI?.controlCenter : undefined;
  const [settings, setSettings] = useState<ControlCenterSettings>(DEFAULTS);

  useEffect(() => {
    api?.get().then((s) => s && setSettings(s));
  }, [api]);

  const update = useCallback(
    async (patch: Partial<ControlCenterSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch })); // optimistic — same reasoning as use-privacy-settings.ts
      const next = await api?.set(patch);
      if (next) setSettings(next);
    },
    [api],
  );

  const runAction = useCallback(
    (request: ControlCenterActionRequest) => api?.action(request),
    [api],
  );

  const getConsoleErrorTotal = useCallback(
    () => api?.getConsoleErrorTotal() ?? Promise.resolve(0),
    [api],
  );

  // Control center's "Tracker blockiert" line (masterplan #5) — same
  // shape as getConsoleErrorTotal above, just scoped to the active tab
  // instead of summed across all of them (a tracker count is naturally a
  // per-page thing to look at, unlike console errors which this app
  // already reports as a session-wide total).
  const getTrackerCountForActiveTab = useCallback(
    () => api?.getTrackerCountForActiveTab() ?? Promise.resolve(0),
    [api],
  );

  // Control center's "Site-Sicherheitscheck sichtbar" (masterplan #4) —
  // same polling shape as the two above.
  const getCurrentSiteSafety = useCallback(
    () => api?.getCurrentSiteSafety() ?? Promise.resolve("unknown" as const),
    [api],
  );

  // Control center's "Bandbreiten-Nutzung" (masterplan #10) — same
  // polling shape again, in bytes.
  const getBandwidthForActiveTab = useCallback(
    () => api?.getBandwidthForActiveTab() ?? Promise.resolve(0),
    [api],
  );

  // Control center's "Live RAM/CPU-Anzeige" (masterplan #11).
  const getResourceUsageForActiveTab = useCallback(
    () => api?.getResourceUsageForActiveTab() ?? Promise.resolve(null),
    [api],
  );

  // Custom CSS pro Domain (masterplan #16) — pre-fills the Tools editor.
  const getCustomCssForActiveTab = useCallback(
    () => api?.getCustomCssForActiveTab() ?? Promise.resolve(null),
    [api],
  );

  // Per-site "X off for this site" toggles — same polling shape as
  // getCustomCssForActiveTab above.
  const getSiteFeatureOverridesForActiveTab = useCallback(
    () => api?.getSiteFeatureOverridesForActiveTab() ?? Promise.resolve(null),
    [api],
  );

  return {
    settings,
    update,
    runAction,
    getConsoleErrorTotal,
    getTrackerCountForActiveTab,
    getCurrentSiteSafety,
    getBandwidthForActiveTab,
    getResourceUsageForActiveTab,
    getCustomCssForActiveTab,
    getSiteFeatureOverridesForActiveTab,
  };
}

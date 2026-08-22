import { useCallback, useEffect, useState } from "react";

// Renderer-side copy of electron/control-center-store.ts's types — same
// pattern as use-privacy-settings.ts.
export type NetworkThrottlePreset = "off" | "slow3g" | "fast3g" | "offline";

export type ControlCenterSettings = {
  adBlockEnabled: boolean;
  javascriptDisabled: boolean;
  cookiesBlocked: boolean;
  doNotTrack: boolean;
  autoplayBlock: boolean;
  popupBlock: boolean;
  networkThrottle: NetworkThrottlePreset;
  dnsOverHttpsEnabled: boolean;
  cameraGlobalBlock: boolean;
  micGlobalBlock: boolean;
  locationGlobalBlock: boolean;
  vpnEnabled: boolean;
  unloadBackgroundTabsOnIdle: boolean;
  backgroundTabsThrottled: boolean;
  hardwareAcceleration: boolean;
  masterMute: boolean;
  darkModeForced: boolean;
  globalZoomFactor: number;
  focusMode: boolean;
};

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
  | "translatePage";

export type ControlCenterActionRequest =
  | {
      type: Exclude<ControlCenterActionType, "setNetworkThrottle" | "translatePage">;
      tabId?: string;
    }
  | { type: "setNetworkThrottle"; tabId?: string; preset: NetworkThrottlePreset }
  | { type: "translatePage"; tabId?: string; langCode: string };

const DEFAULTS: ControlCenterSettings = {
  adBlockEnabled: true,
  javascriptDisabled: false,
  cookiesBlocked: false,
  doNotTrack: true,
  autoplayBlock: false,
  popupBlock: true,
  networkThrottle: "off",
  dnsOverHttpsEnabled: false,
  cameraGlobalBlock: false,
  micGlobalBlock: false,
  locationGlobalBlock: true,
  vpnEnabled: false,
  unloadBackgroundTabsOnIdle: false,
  backgroundTabsThrottled: true,
  hardwareAcceleration: true,
  masterMute: false,
  darkModeForced: false,
  globalZoomFactor: 1,
  focusMode: false,
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

  return { settings, update, runAction, getConsoleErrorTotal };
}

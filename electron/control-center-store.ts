import { JsonStore } from "./json-store";

// Global (not per-profile) settings for the new top-left "Control center"
// dropdown (replaces the old chevron/tabsMenu button — see
// ControlCenterContent.tsx). Kept in its own store/file rather than
// folded into privacy-settings-store.ts because most of these are plain
// browser-behavior toggles, not strictly privacy/security posture, and
// because a couple of them (hardwareAcceleration, autoplayBlock) only take
// effect on the NEXT app launch — worth being able to reason about as a
// separate, self-contained group.
//
// Every field here is intentionally a dumb, serializable value — the
// actual *effect* of flipping one lives in privacy.ts (webRequest/
// permission hooks), tab-manager.ts (per-webContents behavior) or main.ts
// (startup switches), never here. This file only persists the choice.
export type NetworkThrottlePreset = "off" | "slow3g" | "fast3g" | "offline";

export type ControlCenterSettings = {
  // --- network / content ---------------------------------------------
  adBlockEnabled: boolean;
  javascriptDisabled: boolean;
  cookiesBlocked: boolean;
  doNotTrack: boolean;
  autoplayBlock: boolean; // Chromium switch, needs a relaunch to apply
  popupBlock: boolean;
  networkThrottle: NetworkThrottlePreset;
  dnsOverHttpsEnabled: boolean; // mirrors privacy-settings-store's dohProvider (off <-> cloudflare)
  // --- permissions ------------------------------------------------------
  cameraGlobalBlock: boolean;
  micGlobalBlock: boolean;
  locationGlobalBlock: boolean;
  // --- vpn ----------------------------------------------------------
  vpnEnabled: boolean; // mirrors tor-manager's start/stop
  // --- performance --------------------------------------------------
  unloadBackgroundTabsOnIdle: boolean;
  backgroundTabsThrottled: boolean;
  hardwareAcceleration: boolean; // app.disableHardwareAcceleration(), needs a relaunch to apply
  // --- display --------------------------------------------------------
  masterMute: boolean;
  darkModeForced: boolean;
  globalZoomFactor: number; // reuses TabManager.setDefaultZoom
  // --- focus ----------------------------------------------------------
  focusMode: boolean; // purely a renderer-side UI state, but persisted here so it survives restarts
};

export const CONTROL_CENTER_DEFAULTS: ControlCenterSettings = {
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
  locationGlobalBlock: true, // matches this app's existing hardcoded-denied geolocation behavior
  vpnEnabled: false,
  unloadBackgroundTabsOnIdle: false,
  backgroundTabsThrottled: true,
  hardwareAcceleration: true,
  masterMute: false,
  darkModeForced: false,
  globalZoomFactor: 1,
  focusMode: false,
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
  | "setNetworkThrottle";

export type ControlCenterActionRequest =
  | { type: Exclude<ControlCenterActionType, "setNetworkThrottle">; tabId?: string }
  | { type: "setNetworkThrottle"; tabId?: string; preset: NetworkThrottlePreset };

const store = new JsonStore<ControlCenterSettings>("control-center-settings.json");

export function getControlCenterSettings(): ControlCenterSettings {
  return { ...CONTROL_CENTER_DEFAULTS, ...store.read(CONTROL_CENTER_DEFAULTS) };
}

export function setControlCenterSettings(patch: Partial<ControlCenterSettings>): ControlCenterSettings {
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
export function cameraGloballyBlocked(): boolean {
  return getControlCenterSettings().cameraGlobalBlock;
}
export function micGloballyBlocked(): boolean {
  return getControlCenterSettings().micGlobalBlock;
}
export function locationGloballyBlocked(): boolean {
  return getControlCenterSettings().locationGlobalBlock;
}

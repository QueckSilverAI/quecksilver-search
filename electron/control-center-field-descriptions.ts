import { CONTROL_CENTER_DEFAULTS, type ControlCenterSettings } from "./control-center-store";

// One entry per field in ControlCenterSettings — this is what Zora reads
// instead of a hardcoded prompt paragraph (see zora-browser-integration-plan.md,
// section 4). `category` groups them the same way control-center-store.ts's
// own comments do, so a future Settings-UI list (Phase 4) and this can share
// grouping. `options` is only set for fields with a fixed value set
// (enum-like strings or booleans) — Zora uses it to know what values are
// even legal for set_control_center_setting.
export type ControlCenterFieldType = "boolean" | "number" | "string" | "string[]" | "enum";

export type ControlCenterFieldDescription = {
  category: string;
  description: string;
  type: ControlCenterFieldType;
  options?: string[];
  // true if flipping this field only takes effect after an app relaunch —
  // Zora should say so rather than implying it happened instantly.
  requiresRelaunch?: boolean;
};

export const CONTROL_CENTER_FIELD_DESCRIPTIONS: Record<
  keyof ControlCenterSettings,
  ControlCenterFieldDescription
> = {
  adBlockEnabled: { category: "network", description: "Blocks ads on pages.", type: "boolean" },
  javascriptDisabled: { category: "network", description: "Disables JavaScript execution on all pages.", type: "boolean" },
  cookiesBlocked: { category: "network", description: "Blocks all cookies from being set.", type: "boolean" },
  doNotTrack: { category: "network", description: "Sends the Do-Not-Track header with requests.", type: "boolean" },
  autoplayBlock: { category: "network", description: "Blocks video/audio autoplay.", type: "boolean", requiresRelaunch: true },
  popupBlock: { category: "network", description: "Blocks popup windows.", type: "boolean" },
  networkThrottle: {
    category: "network",
    description: "Simulated network speed for the active tab.",
    type: "enum",
    options: ["off", "slow3g", "fast3g", "offline", "custom"],
  },
  customDownloadKbps: { category: "network", description: "Download speed (kbps) used when networkThrottle is 'custom'.", type: "number" },
  customUploadKbps: { category: "network", description: "Upload speed (kbps) used when networkThrottle is 'custom'.", type: "number" },
  customLatencyMs: { category: "network", description: "Latency (ms) used when networkThrottle is 'custom'.", type: "number" },
  dnsOverHttpsEnabled: { category: "network", description: "Whether DNS-over-HTTPS is turned on.", type: "boolean" },
  dnsOverHttpsProvider: {
    category: "network",
    description: "Which DoH provider is used when dnsOverHttpsEnabled is on.",
    type: "enum",
    options: ["cloudflare", "quad9", "google"],
  },
  customBlockedPatterns: { category: "network", description: "User-supplied substring/wildcard patterns to block, in addition to the ad blocker.", type: "string[]" },

  cameraGlobalBlock: { category: "permissions", description: "Blocks camera access for every site.", type: "boolean" },
  micGlobalBlock: { category: "permissions", description: "Blocks microphone access for every site.", type: "boolean" },
  locationGlobalBlock: { category: "permissions", description: "Blocks geolocation access for every site.", type: "boolean" },

  vpnEnabled: { category: "vpn", description: "Whether Tor is running for this window (mirrors the Tor manager's own state).", type: "boolean" },
  vpnKillSwitch: { category: "vpn", description: "Blocks all traffic in a Tor window if Tor disconnects mid-session.", type: "boolean" },

  unloadBackgroundTabsOnIdle: { category: "performance", description: "Frees memory of background tabs that have sat idle a while.", type: "boolean" },
  autoSuspendMinutes: { category: "performance", description: "Minutes a background tab must be idle before it's auto-unloaded. 0 = off.", type: "number" },
  backgroundTabsThrottled: { category: "performance", description: "Throttles CPU/timers of tabs that aren't visible.", type: "boolean" },
  hardwareAcceleration: { category: "performance", description: "Whether GPU hardware acceleration is used.", type: "boolean", requiresRelaunch: true },
  imagesDisabled: { category: "performance", description: "Blocks image loading on all pages.", type: "boolean" },
  preloadDisabled: { category: "performance", description: "Disables Chromium's predictive prefetch/preconnect.", type: "boolean", requiresRelaunch: true },
  batterySaverMode: { category: "performance", description: "Preset: forces backgroundTabsThrottled + unloadBackgroundTabsOnIdle on.", type: "boolean" },

  masterMute: { category: "display", description: "Mutes audio/video across every tab.", type: "boolean" },
  darkModeForced: { category: "display", description: "Forces a dark color scheme on every page.", type: "boolean" },
  globalZoomFactor: { category: "display", description: "Default page zoom factor (1 = 100%).", type: "number" },
  visionFilter: {
    category: "display",
    description: "CSS color filter applied to every tab, for accessibility.",
    type: "enum",
    options: ["none", "high-contrast", "protanopia", "deuteranopia", "tritanopia"],
  },
  cursorSize: {
    category: "display",
    description: "CSS cursor size override applied to every tab.",
    type: "enum",
    options: ["default", "large", "xlarge"],
  },
  gridOverlayEnabled: { category: "display", description: "Shows a fixed alignment grid over every tab, for design work.", type: "boolean" },
  userAgentPreset: {
    category: "display",
    description: "Spoofed User-Agent string applied to every tab.",
    type: "enum",
    options: ["default", "chrome-win", "safari-ios", "firefox-linux"],
  },

  focusMode: { category: "focus", description: "UI-level focus state (hides distractions in the chrome UI).", type: "boolean" },
  doNotDisturb: { category: "focus", description: "Suppresses notification permission prompts/alerts globally.", type: "boolean" },

  webrtcLeakProtection: { category: "privacy", description: "Prevents WebRTC from leaking the real local IP.", type: "boolean", requiresRelaunch: true },
  httpsOnlyEnforced: { category: "privacy", description: "Refuses plain-HTTP navigation, upgrading to HTTPS or blocking.", type: "boolean" },
  cookieAutoDelete: { category: "privacy", description: "Clears a domain's cookies once its last open tab for that domain closes.", type: "boolean" },

  jsErrorOverlayEnabled: { category: "devtools", description: "Shows an on-page red banner when a page throws an uncaught console error.", type: "boolean" },
};

// Startup safety net (see zora-browser-integration-plan.md section 4): if a
// new field is ever added to ControlCenterSettings without a matching entry
// here, Zora would silently not know about it. No test runner is wired up
// in this project, so this is called once from main.ts's startup instead —
// it throws in dev (fail loud, fix immediately) and just logs in production
// (never block the app from starting over a documentation gap).
export function assertControlCenterFieldDescriptionsComplete(isDev: boolean): void {
  const missing = (Object.keys(CONTROL_CENTER_DEFAULTS) as (keyof ControlCenterSettings)[]).filter(
    (key) => !(key in CONTROL_CENTER_FIELD_DESCRIPTIONS),
  );
  if (missing.length === 0) return;
  const msg = `[control-center-field-descriptions] Missing description for: ${missing.join(", ")} — Zora won't know about these fields. Add an entry in control-center-field-descriptions.ts.`;
  if (isDev) throw new Error(msg);
  console.error(msg);
}

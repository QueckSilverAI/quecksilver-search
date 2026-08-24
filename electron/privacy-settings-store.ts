import { JsonStore } from "./json-store";

export type DohProvider = "off" | "cloudflare" | "quad9" | "google";

export type PrivacySettings = {
  removeTrackingParams: boolean;
  httpsOnly: boolean;
  dohProvider: DohProvider;
  panicShortcut: string; // Electron accelerator string, e.g. "CommandOrControl+Shift+Q"
  phishingProtection: boolean;
  torBinaryPath: string; // empty = auto-resolve (bundled path, then PATH) — see tor-manager.ts
  torSecurityLevel: "standard" | "safer" | "safest";
};

const DEFAULTS: PrivacySettings = {
  removeTrackingParams: true,
  httpsOnly: false,
  dohProvider: "off",
  panicShortcut: "CommandOrControl+Shift+Q",
  phishingProtection: true,
  torBinaryPath: "",
  torSecurityLevel: "standard",
};

// Global, not per-profile — these are app-level security posture choices
// (DoH provider, HTTPS-only, the panic shortcut itself), not something
// that should differ between two profiles signed into the same
// installation the way bookmarks or passwords do.
const store = new JsonStore<PrivacySettings>("privacy-settings.json");

export function getPrivacySettings(): PrivacySettings {
  return { ...DEFAULTS, ...store.read(DEFAULTS) };
}

export function setPrivacySettings(patch: Partial<PrivacySettings>): PrivacySettings {
  const next = { ...getPrivacySettings(), ...patch };
  store.write(next);
  return next;
}

// Cheap accessors for the hot paths (checked on every navigation) so
// callers don't need to destructure the whole settings object each time.
export function trackingParamsEnabled(): boolean {
  return getPrivacySettings().removeTrackingParams;
}

export function httpsOnlyEnabled(): boolean {
  return getPrivacySettings().httpsOnly;
}

export function phishingProtectionEnabled(): boolean {
  return getPrivacySettings().phishingProtection;
}

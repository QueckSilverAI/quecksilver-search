import { useCallback, useEffect, useState } from "react";

export type DohProvider = "off" | "cloudflare" | "quad9";
export type PrivacySettings = {
  removeTrackingParams: boolean;
  httpsOnly: boolean;
  dohProvider: DohProvider;
  panicShortcut: string;
  phishingProtection: boolean;
  torBinaryPath: string;
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

export function usePrivacySettings() {
  const api = typeof window !== "undefined" ? window.browserAPI?.privacy : undefined;
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULTS);

  useEffect(() => {
    api?.get().then((s) => s && setSettings(s));
  }, [api]);

  const update = useCallback(
    async (patch: Partial<PrivacySettings>) => {
      setSettings((prev) => ({ ...prev, ...patch })); // optimistic — feels instant for toggles
      const next = await api?.set(patch);
      if (next) setSettings(next);
    },
    [api],
  );

  return { settings, update };
}

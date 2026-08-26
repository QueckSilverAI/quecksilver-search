import { useCallback, useEffect, useState } from "react";

export type PermissionKind = "camera" | "microphone" | "notifications" | "autoDownloads";
export type PermissionState = "allow" | "block";
export type SitePermissionEntry = {
  domain: string;
  camera: PermissionState;
  microphone: PermissionState;
  notifications: PermissionState;
  autoDownloads: PermissionState;
  updatedAt: number;
};

export function useSitePermissions() {
  const api = typeof window !== "undefined" ? window.browserAPI?.permissions : undefined;
  const [entries, setEntries] = useState<SitePermissionEntry[]>([]);

  const refresh = useCallback(() => {
    api?.list().then(setEntries);
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const set = useCallback(
    async (domain: string, kind: PermissionKind, state: PermissionState) => {
      await api?.set(domain, kind, state);
      refresh();
    },
    [api, refresh],
  );
  const remove = useCallback(
    async (domain: string) => {
      await api?.remove(domain);
      refresh();
    },
    [api, refresh],
  );
  // Doesn't touch the entry list itself (the allow/block choices stay as
  // they are) — this only clears what the site actually stored on disk,
  // so no refresh() needed.
  const clearSiteData = useCallback((domain: string) => api?.clearSiteData(domain), [api]);

  return { entries, set, remove, clearSiteData, isElectron: Boolean(api) };
}

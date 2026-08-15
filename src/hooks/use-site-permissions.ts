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

  return { entries, set, remove, isElectron: Boolean(api) };
}

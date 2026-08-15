import { useCallback, useEffect, useState } from "react";
import type { PasswordEntry, PasswordImportResult } from "./use-browser-api";

export function usePasswords() {
  const api = typeof window !== "undefined" ? window.browserAPI?.passwords : undefined;
  const profilesApi = typeof window !== "undefined" ? window.browserAPI?.profiles : undefined;
  const [passwords, setPasswords] = useState<PasswordEntry[]>([]);

  useEffect(() => {
    if (!api) return;
    api.list().then(setPasswords);
    const unsubPasswords = api.onChanged(setPasswords);
    const unsubProfiles = profilesApi?.onChanged(() => {
      api.list().then(setPasswords);
    });
    return () => {
      unsubPasswords();
      unsubProfiles?.();
    };
  }, [api, profilesApi]);

  const add = useCallback((url: string, username: string, password: string) => api?.add(url, username, password), [api]);
  const update = useCallback((id: string, url: string, username: string, password?: string) => api?.update(id, url, username, password), [api]);
  const remove = useCallback((id: string) => api?.remove(id), [api]);
  const importFrom = useCallback((browser: "chrome" | "edge", profileId: string): Promise<PasswordImportResult> | undefined => api?.import(browser, profileId), [api]);

  return { passwords, add, update, remove, importFrom, isElectron: Boolean(api) };
}

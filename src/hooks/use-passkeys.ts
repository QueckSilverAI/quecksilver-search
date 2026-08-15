import { useCallback, useEffect, useState } from "react";
import type { PasskeyEntry } from "./use-browser-api";

export function usePasskeys() {
  const api = typeof window !== "undefined" ? window.browserAPI?.passkeys : undefined;
  const profilesApi = typeof window !== "undefined" ? window.browserAPI?.profiles : undefined;
  const [passkeys, setPasskeys] = useState<PasskeyEntry[]>([]);

  useEffect(() => {
    if (!api) return;
    api.list().then(setPasskeys);
    const unsubPasskeys = api.onChanged(setPasskeys);
    const unsubProfiles = profilesApi?.onChanged(() => {
      api.list().then(setPasskeys);
    });
    return () => {
      unsubPasskeys();
      unsubProfiles?.();
    };
  }, [api, profilesApi]);

  const add = useCallback((url: string, username: string) => api?.add(url, username), [api]);
  const remove = useCallback((id: string) => api?.remove(id), [api]);

  return { passkeys, add, remove, isElectron: Boolean(api) };
}

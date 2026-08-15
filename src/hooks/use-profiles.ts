import { useCallback, useEffect, useState } from "react";
import type { ActiveIdentity, Profile } from "./use-browser-api";

export function useProfiles() {
  const api = typeof window !== "undefined" ? window.browserAPI?.profiles : undefined;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState<ActiveIdentity>({ activeProfileId: null, guestMode: true });

  useEffect(() => {
    if (!api) return;
    api.list().then(setProfiles);
    api.getActive().then(setActive);
    return api.onChanged((value) => {
      setProfiles(value.profiles);
      setActive(value.active);
    });
  }, [api]);

  const createSimpleProfile = useCallback((name: string) => api?.createSimple(name), [api]);
  const renameProfile = useCallback((id: string, name: string) => api?.rename(id, name), [api]);
  const setActiveProfile = useCallback((id: string) => api?.setActive(id), [api]);
  const enterGuestMode = useCallback(() => api?.enterGuest(), [api]);
  const removeProfile = useCallback((id: string) => api?.remove(id), [api]);
  const syncNow = useCallback(() => api?.syncNow(), [api]);
  // "Switch profile" (to an existing different profile, or to guest) opens
  // a brand-new window on that identity — this window keeps running on
  // whatever it already had active.
  const openProfileInNewWindow = useCallback((id: string) => api?.openInNewWindow({ activeProfileId: id, guestMode: false }), [api]);
  const openGuestInNewWindow = useCallback(() => api?.openInNewWindow({ activeProfileId: null, guestMode: true }), [api]);
  const openIncognitoInNewWindow = useCallback(() => api?.openInNewWindow({ activeProfileId: null, guestMode: true, windowMode: "incognito" }), [api]);
  const openTorInNewWindow = useCallback(() => api?.openInNewWindow({ activeProfileId: null, guestMode: true, windowMode: "tor" }), [api]);

  const activeProfile = profiles.find((p) => p.id === active.activeProfileId) ?? null;

  return {
    profiles,
    active,
    activeProfile,
    isGuest: active.guestMode,
    createSimpleProfile,
    renameProfile,
    setActiveProfile,
    enterGuestMode,
    removeProfile,
    syncNow,
    openProfileInNewWindow,
    openGuestInNewWindow,
    openIncognitoInNewWindow,
    openTorInNewWindow,
    isElectron: Boolean(api),
  };
}

import { useCallback, useEffect, useState } from "react";
import type { AuthSession } from "./use-browser-api";

export function useAuth() {
  const api = typeof window !== "undefined" ? window.browserAPI?.auth : undefined;
  const profilesApi = typeof window !== "undefined" ? window.browserAPI?.profiles : undefined;
  const [session, setSession] = useState<AuthSession>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.getSession().then(setSession);
    const unsubAuth = api.onChanged(setSession);
    // The session file is per-profile now (see electron/auth.ts) — switching
    // the active profile (or entering/leaving guest mode) means the
    // previously-loaded session no longer belongs to what's active, so it
    // needs a fresh fetch rather than just clearing it blindly.
    const unsubProfiles = profilesApi?.onChanged(() => {
      api.getSession().then(setSession);
    });
    return () => {
      unsubAuth();
      unsubProfiles?.();
    };
  }, [api, profilesApi]);

  // Returns the resulting session (or null if the login didn't succeed —
  // cancelled, timed out, or the system-browser tab was closed without
  // finishing) so callers that need to know whether it actually worked
  // (e.g. Zora's automatic re-auth-on-401 in use-zora-chat.ts) can react
  // to that directly, instead of reading back the (possibly still-stale,
  // not-yet-re-rendered) `session` value from this same closure.
  const login = useCallback(
    async (mode: "new-profile" | "reauth" = "new-profile"): Promise<AuthSession> => {
      if (!api) return null;
      setPending(true);
      try {
        const result = await api.login(mode);
        setSession(result);
        return result;
      } catch {
        // Rejected either because the person cancelled (see cancelLogin
        // below), the flow timed out, or they closed the system-browser tab
        // without finishing — nothing to show in any case, they can retry.
        return null;
      } finally {
        setPending(false);
      }
    },
    [api],
  );

  // Lets the "Signing in…" button be clicked again to back out of a login
  // that was abandoned in the system browser — without this it just sat
  // disabled and stuck reading "Signing in…" until a multi-minute backend
  // timeout eventually fired (see cancelLoginFlow in electron/auth.ts).
  const cancelLogin = useCallback(async () => {
    if (!api) return;
    await api.cancelLogin();
  }, [api]);

  const logout = useCallback(async () => {
    if (!api) return;
    await api.logout();
    setSession(null);
  }, [api]);

  return { session, isSignedIn: Boolean(session), pending, login, cancelLogin, logout, isElectron: Boolean(api) };
}

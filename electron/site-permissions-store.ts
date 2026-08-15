import { ProfileScopedStore } from "./profile-scoped-store";

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

const DEFAULT_ENTRY = (domain: string): SitePermissionEntry => ({
  domain,
  camera: "block",
  microphone: "block",
  notifications: "block",
  autoDownloads: "block",
  updatedAt: Date.now(),
});

const store = new ProfileScopedStore<SitePermissionEntry[]>("site-permissions.json", []);

export function listSitePermissions(windowId: number): SitePermissionEntry[] {
  return [...store.read(windowId, [])].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSitePermission(windowId: number, domain: string): SitePermissionEntry | null {
  return store.read(windowId, []).find((e) => e.domain === domain) ?? null;
}

// Called from main.ts's setPermissionRequestHandler/setPermissionCheckHandler
// whenever a site asks for something and there's no stored decision yet —
// records it as "block" (matching the app's current always-deny default)
// so it shows up in Settings' "already decided" list without the person
// needing to have consciously clicked anything. If an entry already
// exists, this is a no-op — never overwrites a decision the person (or an
// earlier default) already made.
export function recordDefaultBlock(windowId: number, domain: string, kind: PermissionKind) {
  const entries = store.read(windowId, []);
  const existing = entries.find((e) => e.domain === domain);
  if (existing) return;
  entries.push(DEFAULT_ENTRY(domain));
  store.write(windowId, entries);
}

export function setSitePermission(windowId: number, domain: string, kind: PermissionKind, state: PermissionState) {
  const entries = store.read(windowId, []);
  const existing = entries.find((e) => e.domain === domain);
  if (existing) {
    existing[kind] = state;
    existing.updatedAt = Date.now();
  } else {
    entries.push({ ...DEFAULT_ENTRY(domain), [kind]: state, updatedAt: Date.now() });
  }
  store.write(windowId, entries);
}

export function removeSitePermission(windowId: number, domain: string) {
  store.write(
    windowId,
    store.read(windowId, []).filter((e) => e.domain !== domain),
  );
}

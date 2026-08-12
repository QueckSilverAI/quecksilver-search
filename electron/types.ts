// Shared between electron/main + preload and the renderer (src/hooks/use-browser-api.ts).
// Keep this file dependency-free (no Electron imports) so the renderer can import
// the types too without pulling in Node/Electron code.

export const HOME_URL = "quecksilver://newtab";
export const SETTINGS_URL = "quecksilver://settings";

export type TabState = {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isHome: boolean;
  isSettings: boolean;
};

export type TabsSnapshot = {
  activeId: string | null;
  // The second tab shown side-by-side in split view, or null when split
  // view is off. Always shown on the right; activeId's tab is the left.
  secondaryId: string | null;
  tabs: TabState[];
};

export type ContentBounds = { x: number; y: number; width: number; height: number };

export type Bookmark = { label: string; url: string } | null;

// The header bookmarks bar — a growable list, separate from the 5 fixed
// home-page bookmark slots (Bookmark[] above).
export type HeaderFavorite = { id: string; label: string; url: string; iconOnly?: boolean };

export type AuthSession = {
  accessToken: string;
  userId: string | null;
  email: string | null;
  obtainedAt: number;
} | null;

// --- Profiles ------------------------------------------------------------
// A "quecksilver" profile is linked to a QueckSilver account (its own
// AuthSession, stored per-profile — see profile-store.ts) and syncs
// favorites/settings/passwords to Supabase in addition to the local copy.
// A "simple" profile is local-only: just a name, no login. Guest mode
// (activeProfileId === null && guestMode === true) is not a profile at
// all — nothing persists across restarts for it.
export type ProfileKind = "quecksilver" | "simple";

export type Profile = {
  id: string;
  kind: ProfileKind;
  name: string;
  email: string | null; // quecksilver profiles only
  createdAt: number;
};

export type ActiveIdentity = {
  activeProfileId: string | null;
  guestMode: boolean;
};

// --- Passwords -------------------------------------------------------------
// What the renderer sees — password already decrypted for display/use.
export type PasswordEntry = {
  id: string;
  url: string;
  username: string;
  password: string;
  createdAt: number;
  updatedAt: number;
};

// What's actually written to disk — password stays encrypted at rest via
// Electron's safeStorage (OS-backed: DPAPI on Windows, Keychain on macOS,
// libsecret/kwallet on Linux where available).
export type StoredPasswordEntry = {
  id: string;
  url: string;
  username: string;
  encryptedPassword: string; // base64, or "plain:<text>" if OS encryption is unavailable
  createdAt: number;
  updatedAt: number;
};

export type PasswordImportResult = {
  imported: number;
  skipped: number;
  // Set when the platform/browser combination isn't supported yet, or the
  // OS-level decryption failed — shown to the person instead of silently
  // importing nothing.
  error: string | null;
};

export type DownloadItem = {
  id: string;
  filename: string;
  path: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
};

export type ToolResult = { ok: boolean; text: string };

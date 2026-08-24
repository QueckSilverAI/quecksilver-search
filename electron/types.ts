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
  groupId: string | null;
  nightMode: boolean;
  isAudible: boolean;
  isMuted: boolean;
  // ms since epoch, set once when the tab is first created — used by the
  // tabs-menu dropdown (TabsMenuContent.tsx) to show a relative "opened
  // Xm ago" label under each tab's title.
  openedAt: number;
};

export type TabGroup = { id: string; name: string; color: string; collapsed: boolean };

export type TabsSnapshot = {
  activeId: string | null;
  // The second tab shown side-by-side in split view, or null when split
  // view is off. Always shown on the right; activeId's tab is the left.
  secondaryId: string | null;
  tabs: TabState[];
  groups: TabGroup[];
};

// What gets persisted (only for the primary window — same "only the
// primary window's stuff survives a restart" rule profile-store.ts already
// follows) so a crash or a "restore last session" start can recreate the
// tabs that were open. Doesn't include page state/scroll position/form
// data — just enough to reopen the same URLs in the same groups.
export type SessionSnapshot = {
  tabs: { url: string; groupId: string | null }[];
  groups: TabGroup[];
  activeIndex: number;
};

// Sent to the renderer once at startup — tells it whether there's a
// snapshot worth offering to restore, and whether last exit looked like a
// crash (no matching clean-exit flag) vs a normal quit.
export type SessionRecovery = { available: boolean; tabCount: number; crashed: boolean };

export type ContentBounds = { x: number; y: number; width: number; height: number };

export type Bookmark = { label: string; url: string } | null;

// The header bookmarks bar — a growable list, separate from the 5 fixed
// home-page bookmark slots (Bookmark[] above).
export type HeaderFavorite = {
  id: string;
  label: string;
  url: string;
  iconOnly?: boolean;
  // Both added for sync conflict resolution (see sync-merge.ts) — updatedAt
  // lets a merge tell which of two devices' edits to the same entry is
  // newer, deletedAt is a tombstone marking "removed on some device" so a
  // deletion actually survives being merged with a device that hasn't seen
  // it yet. Neither is shown anywhere in the UI.
  updatedAt?: number;
  deletedAt?: number;
};

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

export type WindowMode = "normal" | "incognito" | "tor";

export type ActiveIdentity = {
  activeProfileId: string | null;
  guestMode: boolean;
  // Absent/"normal" for every regular and guest window — only set for the
  // two special window kinds, which need to know this from the moment
  // they're created (their session partition and, for Tor, proxy routing
  // are both set up once at window-creation time, not something that
  // can be toggled on an existing window afterward).
  windowMode?: WindowMode;
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
  // Tombstone for sync conflict resolution — see sync-merge.ts. A removed
  // password is marked deleted rather than actually dropped from the file
  // until the tombstone ages out, so the deletion can propagate to another
  // device on its next sync instead of quietly reappearing there.
  deletedAt?: number;
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

export type ToolResult = { ok: boolean; text: string; imageBase64?: string };

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

// Mirrors favorites/bookmarks/passwords/settings to Supabase for
// QueckSilver-linked profiles, in addition to the local per-profile files
// (favorites-store.ts, bookmark-store.ts, passwords-store.ts) — the local
// copy stays authoritative for offline use, this just keeps a cloud copy in
// sync whenever something changes.
//
// Needs a `search_profile_data` table in the same Supabase project as
// QueckSilver AI, one row per user (see supabase/search_profile_data.sql
// for the migration — this has to be run once against the project by
// someone with DB access, not something this app can do on its own).
//
// Security note: passwords are sent to this table AS-IS (already decrypted
// on this end, since local storage only needs OS-level protection, not a
// portable secret) — protected only by TLS in transit and Supabase's row-
// level security at rest, not end-to-end encrypted with a key only the
// person holds. That's a real trade-off worth being aware of, not hidden
// here: anyone with legitimate database access at the Supabase project
// level could in principle read stored passwords. If that's not
// acceptable, the alternative is encrypting the password blob client-side
// with a key derived from something only the person has (e.g. a separate
// master password) before it ever leaves this app — a meaningfully bigger
// feature than what's built here.
type ProfileDataRow = {
  user_id: string;
  header_favorites: unknown;
  bookmarks: unknown;
  passwords: unknown;
  settings: unknown;
  updated_at: string;
};

async function upsert(accessToken: string, userId: string, partial: Partial<Omit<ProfileDataRow, "user_id" | "updated_at">>) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/search_profile_data`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ user_id: userId, ...partial, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) console.error("[supabase-sync] upsert failed:", res.status, await res.text().catch(() => ""));
  } catch (err) {
    console.error("[supabase-sync] upsert failed:", err);
  }
}

export function syncHeaderFavorites(accessToken: string, userId: string, favorites: unknown) {
  void upsert(accessToken, userId, { header_favorites: favorites });
}

export function syncBookmarks(accessToken: string, userId: string, bookmarks: unknown) {
  void upsert(accessToken, userId, { bookmarks });
}

export function syncPasswords(accessToken: string, userId: string, passwords: unknown) {
  void upsert(accessToken, userId, { passwords });
}

export function syncSettings(accessToken: string, userId: string, settings: unknown) {
  void upsert(accessToken, userId, { settings });
}

// Awaitable variant, all four fields in one request — used by the manual
// "Sync now" button in ProfilePopup.tsx, which needs to actually know when
// the push finished (to stop showing its progress bar), unlike the
// fire-and-forget calls above that fire silently after every local change.
export async function syncAllNow(accessToken: string, userId: string, data: { header_favorites: unknown; bookmarks: unknown; passwords: unknown }): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/search_profile_data`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ user_id: userId, ...data, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch (err) {
    console.error("[supabase-sync] syncAllNow failed:", err);
    return false;
  }
}

export async function pullProfileData(accessToken: string, userId: string): Promise<ProfileDataRow | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/search_profile_data?user_id=eq.${encodeURIComponent(userId)}&select=*`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as ProfileDataRow[];
    return rows[0] ?? null;
  } catch (err) {
    console.error("[supabase-sync] pull failed:", err);
    return null;
  }
}

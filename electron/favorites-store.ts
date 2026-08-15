import { ProfileScopedStore } from "./profile-scoped-store";
import type { HeaderFavorite } from "./types";
import { diffAndTombstone, withoutTombstones } from "./sync-merge";

// The header bookmarks bar — a growable list, completely separate from the
// 5 fixed home-page bookmark slots (electron/bookmark-store.ts). Each entry
// can be marked iconOnly (the "Show icon only" context-menu option).
// Per-profile — see profile-scoped-store.ts.
const store = new ProfileScopedStore<HeaderFavorite[]>("header-favorites.json", []);

// Tombstones (soft-deleted entries kept around briefly for sync conflict
// resolution — see sync-merge.ts) are stored on disk but never handed back
// to the renderer or the sync layer's local-only reads.
export function listHeaderFavorites(windowId: number): HeaderFavorite[] {
  return withoutTombstones(store.read(windowId, []));
}

// Includes tombstones — only for supabase-sync.ts's merge step, which needs
// to see "was deleted here" to correctly propagate that to another device.
export function listHeaderFavoritesForSync(windowId: number): HeaderFavorite[] {
  return store.read(windowId, []);
}

// The renderer edits header favorites as a whole array (add/remove/reorder
// all happen client-side, then the full result is saved) rather than via
// per-item add/update/remove calls like passwords — diffAndTombstone infers
// per-item updatedAt/deletedAt from what changed against the previous save.
export function saveHeaderFavorites(windowId: number, favorites: HeaderFavorite[]) {
  const previous = store.read(windowId, []);
  store.write(windowId, diffAndTombstone(previous, favorites));
}

// Used after a sync merge to write back the merged (local + remote) result
// as the new local truth, tombstones included.
export function overwriteHeaderFavorites(windowId: number, merged: HeaderFavorite[]) {
  store.write(windowId, merged);
}

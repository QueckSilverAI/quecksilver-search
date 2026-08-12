import { ProfileScopedStore } from "./profile-scoped-store";
import type { HeaderFavorite } from "./types";

// The header bookmarks bar — a growable list, completely separate from the
// 5 fixed home-page bookmark slots (electron/bookmark-store.ts). Each entry
// can be marked iconOnly (the "Show icon only" context-menu option).
// Per-profile — see profile-scoped-store.ts.
const store = new ProfileScopedStore<HeaderFavorite[]>("header-favorites.json", []);

export function listHeaderFavorites(windowId: number): HeaderFavorite[] {
  return store.read(windowId, []);
}

export function saveHeaderFavorites(windowId: number, favorites: HeaderFavorite[]) {
  store.write(windowId, favorites);
}

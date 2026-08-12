import { ProfileScopedStore } from "./profile-scoped-store";
import type { Bookmark } from "./types";

const SLOT_COUNT = 5;
// Per-profile — see profile-scoped-store.ts.
const store = new ProfileScopedStore<Bookmark[]>("bookmarks.json", Array(SLOT_COUNT).fill(null));

export function listBookmarks(windowId: number): Bookmark[] {
  const saved = store.read(windowId, Array(SLOT_COUNT).fill(null));
  const normalized = Array.from({ length: SLOT_COUNT }, (_, i) => saved[i] ?? null);
  return normalized;
}

export function saveBookmarks(windowId: number, bookmarks: Bookmark[]) {
  store.write(windowId, bookmarks.slice(0, SLOT_COUNT));
}

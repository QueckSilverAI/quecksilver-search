import path from "node:path";
import { JsonStore } from "./json-store";
import { getActiveProfileId, isGuestMode } from "./profile-store";

// Wraps a JsonStore so its file lives under profiles/<activeProfileId>/...
// instead of a fixed path — every profile gets its own completely separate
// copy of whatever this wraps (favorites, home-page bookmarks, passwords).
// Guest mode never touches disk at all: reads/writes go to a plain in-
// memory Map that's gone the moment the app restarts, matching "guest
// browsing leaves nothing behind".
//
// Takes a windowId on every call, not just once at construction — each
// window can have its own active profile (see profile-store.ts), so which
// file/guest-slot this resolves to can genuinely differ per window, even
// though there's only ever one ProfileScopedStore instance per kind of
// data (one for favorites, one for bookmarks, one for passwords, ...).
const guestMemory = new Map<string, unknown>();

export class ProfileScopedStore<T> {
  constructor(
    private fileName: string,
    private guestDefault: T,
  ) {}

  private diskStore(windowId: number): JsonStore<T> | null {
    if (isGuestMode(windowId)) return null;
    const id = getActiveProfileId(windowId);
    if (!id) return null;
    return new JsonStore<T>(path.join("profiles", id, this.fileName));
  }

  private guestKey(windowId: number): string {
    return `${windowId}:${this.fileName}`;
  }

  read(windowId: number, fallback: T): T {
    const store = this.diskStore(windowId);
    if (!store) return (guestMemory.get(this.guestKey(windowId)) as T | undefined) ?? this.guestDefault;
    return store.read(fallback);
  }

  write(windowId: number, value: T) {
    const store = this.diskStore(windowId);
    if (!store) {
      guestMemory.set(this.guestKey(windowId), value);
      return;
    }
    store.write(value);
  }

  // Called when a window enters guest mode so a later guest session in
  // that SAME window doesn't inherit an earlier guest session's in-memory
  // data from the same app run — each "become a guest" is meant to start
  // clean. Scoped to just that window, not every guest window at once.
  static clearGuestMemoryFor(windowId: number) {
    for (const key of guestMemory.keys()) {
      if (key.startsWith(`${windowId}:`)) guestMemory.delete(key);
    }
  }
}

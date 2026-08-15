import { randomUUID } from "node:crypto";
import { ProfileScopedStore } from "./profile-scoped-store";
import type { PasskeyEntry } from "./types";

// Per-profile — see profile-scoped-store.ts. See the PasskeyEntry comment
// in types.ts for why this only ever holds metadata, never key material.
const store = new ProfileScopedStore<PasskeyEntry[]>("passkeys.json", []);

export function listPasskeys(windowId: number): PasskeyEntry[] {
  return store.read(windowId, []);
}

// De-duplicates on url+username — a page that calls
// navigator.credentials.create() more than once for the same account (a
// retry after the person cancelled the OS prompt, for instance) shouldn't
// pile up repeat entries.
export function addPasskey(windowId: number, url: string, username: string): PasskeyEntry {
  const entries = store.read(windowId, []);
  const existing = entries.find((e) => e.url === url && e.username === username);
  if (existing) return existing;
  const entry: PasskeyEntry = { id: randomUUID(), url, username, createdAt: Date.now() };
  entries.push(entry);
  store.write(windowId, entries);
  return entry;
}

export function removePasskey(windowId: number, id: string) {
  store.write(windowId, store.read(windowId, []).filter((e) => e.id !== id));
}

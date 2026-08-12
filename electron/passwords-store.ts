import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { ProfileScopedStore } from "./profile-scoped-store";
import type { PasswordEntry, StoredPasswordEntry } from "./types";

// Per-profile — see profile-scoped-store.ts. Passwords are encrypted at
// rest via Electron's safeStorage, which wraps the OS's own credential
// protection (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on
// Linux where available) — the same mechanism Chrome itself uses. We never
// implement our own encryption scheme for this.
const store = new ProfileScopedStore<StoredPasswordEntry[]>("passwords.json", []);

function encrypt(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString("base64");
  }
  // Rare (no OS keychain/credential store available at all, e.g. some
  // minimal Linux setups) — falls back to a clearly-marked plain blob
  // rather than throwing, so the feature still works without silently
  // pretending it's encrypted when it isn't.
  return `plain:${plain}`;
}

function decrypt(stored: string): string {
  if (stored.startsWith("plain:")) return stored.slice(6);
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch (err) {
    console.error("[passwords] failed to decrypt an entry:", err);
    return "";
  }
}

function toPublic(e: StoredPasswordEntry): PasswordEntry {
  return { id: e.id, url: e.url, username: e.username, password: decrypt(e.encryptedPassword), createdAt: e.createdAt, updatedAt: e.updatedAt };
}

export function listPasswords(windowId: number): PasswordEntry[] {
  return store.read(windowId, []).map(toPublic);
}

// Loose hostname match — the stored url might be a bare domain (typed
// manually, "google.com") or a full origin with protocol/path (imported
// from Chrome, "https://accounts.google.com/ServiceLogin"). Matches if
// either hostname is the same as, or a subdomain of, the other, so a
// password saved for "google.com" still offers itself on
// "accounts.google.com" and vice versa.
function hostnameOf(url: string): string | null {
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function findPasswordsForHost(windowId: number, host: string): PasswordEntry[] {
  const target = host.replace(/^www\./, "");
  const matches = listPasswords(windowId).filter((p) => {
    const entryHost = hostnameOf(p.url);
    if (!entryHost) return false;
    return entryHost === target || entryHost.endsWith(`.${target}`) || target.endsWith(`.${entryHost}`);
  });

  // Autofill only ever fills automatically when there's EXACTLY one match
  // — deliberately, to never guess between two genuinely different
  // accounts on the same site. But "2 matches" often isn't actually two
  // different accounts: an import can save the same login twice under
  // slightly different urls ("aternos.org" vs "https://aternos.org/go/"),
  // or a manual add duplicates an already-imported entry. Collapsing
  // same-username entries down to the most recently updated one turns
  // that accidental duplication back into the single match it really is,
  // without weakening the real safety check for an actual second account.
  const byUsername = new Map<string, PasswordEntry>();
  for (const entry of matches) {
    const key = entry.username.toLowerCase();
    const existing = byUsername.get(key);
    if (!existing || entry.updatedAt > existing.updatedAt) byUsername.set(key, entry);
  }
  return Array.from(byUsername.values());
}

// Called when a login form is submitted on a real page (see tab-preload.ts)
// — saves silently (no "Save password?" prompt) unless the exact same
// url+username+password is already saved, so re-submitting an unchanged
// login doesn't spam a new "saved" confirmation every time. Returns null
// when nothing needed to change.
export function autoSaveFromForm(windowId: number, url: string, username: string, password: string): PasswordEntry | null {
  if (!password) return null;
  const entries = store.read(windowId, []);
  const targetHost = hostnameOf(url);
  const existingIdx = entries.findIndex((e) => hostnameOf(e.url) === targetHost && e.username === username);

  if (existingIdx !== -1) {
    const existing = entries[existingIdx]!;
    if (decrypt(existing.encryptedPassword) === password) return null; // identical to what's already saved
    entries[existingIdx] = { ...existing, encryptedPassword: encrypt(password), updatedAt: Date.now() };
    store.write(windowId, entries);
    return toPublic(entries[existingIdx]!);
  }

  const now = Date.now();
  const entry: StoredPasswordEntry = { id: randomUUID(), url, username, encryptedPassword: encrypt(password), createdAt: now, updatedAt: now };
  entries.push(entry);
  store.write(windowId, entries);
  return toPublic(entry);
}

export function addPassword(windowId: number, url: string, username: string, password: string): PasswordEntry {
  const entries = store.read(windowId, []);
  const now = Date.now();
  const entry: StoredPasswordEntry = { id: randomUUID(), url, username, encryptedPassword: encrypt(password), createdAt: now, updatedAt: now };
  entries.push(entry);
  store.write(windowId, entries);
  return toPublic(entry);
}

// password is optional — omitted (undefined) means "keep the existing one",
// used when just editing the url/username in the Settings list without
// having to re-type the password.
export function updatePassword(windowId: number, id: string, url: string, username: string, password?: string): PasswordEntry | null {
  const entries = store.read(windowId, []);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const existing = entries[idx]!;
  entries[idx] = {
    ...existing,
    url,
    username,
    encryptedPassword: password !== undefined ? encrypt(password) : existing.encryptedPassword,
    updatedAt: Date.now(),
  };
  store.write(windowId, entries);
  return toPublic(entries[idx]!);
}

export function removePassword(windowId: number, id: string) {
  store.write(windowId, store.read(windowId, []).filter((e) => e.id !== id));
}

// Bulk-adds entries from an import (see password-import.ts) — skips any
// entry whose url+username pair already exists, so re-running an import
// doesn't create duplicates.
export function importPasswords(windowId: number, imported: { url: string; username: string; password: string }[]): { imported: number; skipped: number } {
  const entries = store.read(windowId, []);
  const existingKeys = new Set(entries.map((e) => `${e.url}\u0000${e.username}`));
  let importedCount = 0;
  let skipped = 0;
  const now = Date.now();
  for (const item of imported) {
    const key = `${item.url}\u0000${item.username}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    existingKeys.add(key);
    entries.push({ id: randomUUID(), url: item.url, username: item.username, encryptedPassword: encrypt(item.password), createdAt: now, updatedAt: now });
    importedCount++;
  }
  store.write(windowId, entries);
  return { imported: importedCount, skipped };
}

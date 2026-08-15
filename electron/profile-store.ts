import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import { JsonStore } from "./json-store";
import type { ActiveIdentity, Profile } from "./types";

const profilesStore = new JsonStore<Profile[]>("profiles.json");
// Only the FIRST window the app opens (the "primary" one) persists its
// active identity to disk — that's what a restart resumes into. Any
// additional window opened via "switch profile" (see main.ts's
// createWindowForProfile) gets its own in-memory-only identity instead:
// each such window is a deliberate, explicit choice made in that session,
// not something a restart should try to recreate on its own.
const activeStore = new JsonStore<ActiveIdentity>("active-profile.json");

// Per-window active identity — the whole point of "switch profile opens a
// new window": two windows can be logged into two different profiles (or
// one profile + one guest) at the same time, each fully isolated. Keyed by
// BrowserWindow.id. Never persisted here directly; only the primary
// window's entry is mirrored to activeStore, see setPrimaryWindow below.
const windowIdentities = new Map<number, ActiveIdentity>();
let primaryWindowId: number | null = null;

export function setPrimaryWindow(windowId: number) {
  primaryWindowId = windowId;
}

export function isPrimaryWindow(windowId: number): boolean {
  return windowId === primaryWindowId;
}

// Called once when a window is created — seeds its in-memory identity.
// The primary window reads whatever was last persisted; any other window
// is given an explicit starting identity by its caller (createWindowForProfile).
export function initWindowIdentity(windowId: number, identity?: ActiveIdentity) {
  if (identity) {
    windowIdentities.set(windowId, identity);
    return;
  }
  windowIdentities.set(windowId, activeStore.read({ activeProfileId: null, guestMode: true }));
}

export function disposeWindowIdentity(windowId: number) {
  windowIdentities.delete(windowId);
}

export function listProfiles(): Profile[] {
  return profilesStore.read([]);
}

export function getProfile(id: string): Profile | null {
  return listProfiles().find((p) => p.id === id) ?? null;
}

function readActive(windowId: number): ActiveIdentity {
  return windowIdentities.get(windowId) ?? { activeProfileId: null, guestMode: true };
}

function writeActive(windowId: number, identity: ActiveIdentity) {
  windowIdentities.set(windowId, identity);
  if (windowId === primaryWindowId) activeStore.write(identity);
}

export function getActiveProfileId(windowId: number): string | null {
  const active = readActive(windowId);
  return active.guestMode ? null : active.activeProfileId;
}

export function isGuestMode(windowId: number): boolean {
  return readActive(windowId).guestMode;
}

export function getActiveIdentity(windowId: number): ActiveIdentity {
  return readActive(windowId);
}

// Broadcasts the current identity to the ONE window whose identity
// changed — never to every window, since each window's active profile is
// now fully independent (a switch in one window must never disturb what
// another window is showing).
function emitChange(win: BrowserWindow) {
  win.webContents.send("profiles:changed", { profiles: listProfiles(), active: readActive(win.id) });
}

export function createSimpleProfile(win: BrowserWindow, name: string): Profile {
  const profile: Profile = { id: randomUUID(), kind: "simple", name: name.trim() || "Profile", email: null, createdAt: Date.now() };
  const profiles = listProfiles();
  profiles.push(profile);
  profilesStore.write(profiles);
  setActiveProfile(win, profile.id);
  return profile;
}

// Called once a QueckSilver login flow (see auth.ts) has already produced
// a session — registers the profile entry and makes it active. The
// session itself is stored separately, per-profile (see
// getProfileSessionStore in auth.ts), not here.
export function createQuecksilverProfile(win: BrowserWindow, email: string | null): Profile {
  const profile: Profile = { id: randomUUID(), kind: "quecksilver", name: email ?? "QueckSilver account", email, createdAt: Date.now() };
  const profiles = listProfiles();
  profiles.push(profile);
  profilesStore.write(profiles);
  setActiveProfile(win, profile.id);
  return profile;
}

export function renameProfile(win: BrowserWindow, id: string, name: string) {
  const profiles = listProfiles();
  const profile = profiles.find((p) => p.id === id);
  if (!profile || profile.kind !== "simple") return; // quecksilver profiles are named from the account, not editable here
  profile.name = name.trim() || profile.name;
  profilesStore.write(profiles);
  emitChange(win);
}

export function setActiveProfile(win: BrowserWindow, id: string) {
  if (!getProfile(id)) return;
  writeActive(win.id, { activeProfileId: id, guestMode: false });
  emitChange(win);
}

export function enterGuestMode(win: BrowserWindow) {
  writeActive(win.id, { activeProfileId: null, guestMode: true });
  emitChange(win);
}

// Removes a profile entirely — its own favorites/bookmarks/passwords/
// session files (profiles/<id>/...) are cleaned up by the caller in
// main.ts, since that needs the profile-scoped store helpers which would
// otherwise create an import cycle with this file.
export function removeProfile(win: BrowserWindow, id: string) {
  const profiles = listProfiles().filter((p) => p.id !== id);
  profilesStore.write(profiles);
  const active = readActive(win.id);
  if (active.activeProfileId === id) {
    // Falls back to guest mode rather than guessing which remaining
    // profile (if any) the person would want active next.
    writeActive(win.id, { activeProfileId: null, guestMode: true });
  }
  emitChange(win);
}

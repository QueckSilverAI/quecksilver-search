import { JsonStore } from "./json-store";
import type { SessionSnapshot } from "./types";

// Only the primary window's tabs are persisted — same rule profile-store.ts
// already applies to the active profile identity: any extra window opened
// via "switch profile" is a deliberate one-off for that session, not
// something a restart should try to recreate.
const snapshotStore = new JsonStore<SessionSnapshot | null>("session-snapshot.json");
const flagStore = new JsonStore<{ cleanExit: boolean }>("session-flag.json");
// "Continue where you left off" — off by default (a fresh Start page on
// every launch is the current/expected behavior); when on, the snapshot
// below is restored silently at startup instead of only being offered
// after a detected crash.
const settingsStore = new JsonStore<{ restoreOnStart: boolean }>("session-settings.json");

export function getRestoreOnStart(): boolean {
  return settingsStore.read({ restoreOnStart: false }).restoreOnStart;
}

export function setRestoreOnStart(value: boolean) {
  settingsStore.write({ restoreOnStart: value });
}

export function readSnapshot(): SessionSnapshot | null {
  return snapshotStore.read(null);
}

export function writeSnapshot(snapshot: SessionSnapshot) {
  snapshotStore.write(snapshot);
}

// Called once, early at startup, BEFORE markRunning() below overwrites the
// flag — this is what tells the difference between "last quit was normal"
// and "the app never got to clean up" (a crash, a force-kill, a power
// loss...).
export function lastExitWasClean(): boolean {
  return flagStore.read({ cleanExit: true }).cleanExit;
}

// Flips the flag to "not clean" for the run that's starting now — if the
// app actually does exit cleanly later, markCleanExit() flips it back
// before quitting. If it doesn't (crash), this false is exactly what
// lastExitWasClean() reads back as "not clean" on the next launch.
export function markRunning() {
  flagStore.write({ cleanExit: false });
}

export function markCleanExit() {
  flagStore.write({ cleanExit: true });
}

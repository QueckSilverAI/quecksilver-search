import { session } from "electron";
import { JsonStore } from "./json-store";

// Electron can only load UNPACKED extensions (a folder with a manifest.json,
// not a .crx from the Chrome Web Store) — session.loadExtension() is the
// same mechanism Chrome DevTools' "Load unpacked" uses. No auto-update for
// these, no Web Store browsing; the person has to already have the
// extension's folder on disk (e.g. downloaded and unzipped themselves).
// Global, not per-profile — an installed extension is a property of the
// app installation, not of who's currently signed in.
type LoadedExtension = { id: string; name: string; path: string; enabled: boolean };

const store = new JsonStore<LoadedExtension[]>("extensions.json");

export async function loadStoredExtensions() {
  const stored = store.read([]);
  for (const ext of stored) {
    if (!ext.enabled) continue;
    try {
      await session.defaultSession.loadExtension(ext.path);
    } catch (err) {
      console.error(`[extensions] failed to reload ${ext.path}:`, err);
    }
  }
}

export async function addExtension(path: string): Promise<LoadedExtension> {
  const loaded = await session.defaultSession.loadExtension(path);
  const entry: LoadedExtension = { id: loaded.id, name: loaded.name, path, enabled: true };
  const all = store.read([]).filter((e) => e.path !== path);
  all.push(entry);
  store.write(all);
  return entry;
}

export function listExtensions(): LoadedExtension[] {
  return store.read([]);
}

export async function removeExtension(id: string) {
  try {
    session.defaultSession.removeExtension(id);
  } catch {
    /* already unloaded — fine */
  }
  store.write(store.read([]).filter((e) => e.id !== id));
}

export async function setExtensionEnabled(id: string, enabled: boolean) {
  const all = store.read([]);
  const entry = all.find((e) => e.id === id);
  if (!entry) return;
  entry.enabled = enabled;
  store.write(all);
  if (enabled) {
    try {
      await session.defaultSession.loadExtension(entry.path);
    } catch (err) {
      console.error(`[extensions] failed to enable ${entry.path}:`, err);
    }
  } else {
    try {
      session.defaultSession.removeExtension(id);
    } catch {
      /* already unloaded — fine */
    }
  }
}

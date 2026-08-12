import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { HeaderFavorite } from "./types";

// Chrome and Edge both store bookmarks as a plain JSON file (unlike
// Firefox, which uses a SQLite database — deliberately not supported here,
// per the tradeoff Juri agreed to: real extra complexity for one browser).
type ChromeBookmarkNode = {
  type: "url" | "folder";
  name: string;
  url?: string;
  children?: ChromeBookmarkNode[];
};

export type ChromiumProfile = { id: string; name: string };

export function userDataDir(browser: "chrome" | "edge"): string | null {
  const home = app.getPath("home");
  const dirs: Record<string, string> = {
    win32: path.join(process.env.LOCALAPPDATA || "", browser === "chrome" ? "Google\\Chrome\\User Data" : "Microsoft\\Edge\\User Data"),
    darwin: path.join(home, "Library/Application Support", browser === "chrome" ? "Google/Chrome" : "Microsoft Edge"),
    linux: path.join(home, ".config", browser === "chrome" ? "google-chrome" : "microsoft-edge"),
  };
  const dir = dirs[process.platform];
  return dir && existsSync(dir) ? dir : null;
}

// Each profile is its own folder ("Default", "Profile 1", ...) — the
// display names people actually recognize ("Work", a Google account name)
// live in Local State, one level up from any single profile's own folder.
export function listChromiumProfiles(browser: "chrome" | "edge"): ChromiumProfile[] {
  const dir = userDataDir(browser);
  if (!dir) return [];
  const localStatePath = path.join(dir, "Local State");
  if (!existsSync(localStatePath)) return [];
  try {
    const data = JSON.parse(readFileSync(localStatePath, "utf-8"));
    const cache: Record<string, { name?: string; gaia_name?: string; gaia_given_name?: string; shortcut_name?: string }> = data.profile?.info_cache ?? {};
    // profiles_order is the browser's own curated list, in the order the
    // person actually arranged their profiles — preferred over just
    // iterating info_cache's keys, which can retain stale entries for
    // profiles that were since removed from the active switcher.
    const order: string[] = Array.isArray(data.profile?.profiles_order) && data.profile.profiles_order.length > 0
      ? data.profile.profiles_order
      : Object.keys(cache);
    return order
      .filter((id) => id in cache && id !== "System Profile" && id !== "Guest Profile")
      .map((id) => {
        const info = cache[id];
        const name = info?.gaia_given_name || info?.gaia_name || info?.name || info?.shortcut_name || id;
        return { id, name };
      });
  } catch (err) {
    console.error(`[bookmark-import] failed to read ${browser} profile list:`, err);
    return [];
  }
}

function flatten(node: ChromeBookmarkNode, out: HeaderFavorite[]) {
  if (node.type === "url" && node.url) {
    out.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label: node.name || node.url, url: node.url });
  }
  for (const child of node.children ?? []) flatten(child, out);
}

// Returns null only if the profile itself doesn't exist; an empty array
// means the profile exists but genuinely has no bookmarks yet (a fresh
// profile that's never touched its bookmarks bar) — those are different
// situations and shouldn't show the same "couldn't find it" message.
export function importChromiumBookmarks(browser: "chrome" | "edge", profileId: string): HeaderFavorite[] | null {
  const dir = userDataDir(browser);
  if (!dir || !existsSync(path.join(dir, profileId))) return null;
  const file = path.join(dir, profileId, "Bookmarks");
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"));
    const out: HeaderFavorite[] = [];
    for (const root of Object.values<ChromeBookmarkNode>(data.roots ?? {})) {
      if (root && typeof root === "object") flatten(root, out);
    }
    return out;
  } catch (err) {
    console.error(`[bookmark-import] failed to read ${browser} bookmarks:`, err);
    return null;
  }
}

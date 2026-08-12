import { app } from "electron";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";

// Small helper for reading/writing a single JSON file under Electron's
// userData directory. Deliberately not a real database — QueckSilver Search
// only ever persists small things (bookmarks, favorites, passwords, one
// auth session per profile), so a dependency like electron-store would be
// overkill.
//
// fileName may include subdirectories (e.g. "profiles/<id>/passwords.json"
// for per-profile storage — see profile-scoped-store.ts) — the parent
// directory is created on demand before writing.
export class JsonStore<T> {
  private filePath: string;

  constructor(fileName: string) {
    this.filePath = path.join(app.getPath("userData"), fileName);
  }

  read(fallback: T): T {
    try {
      if (!existsSync(this.filePath)) return fallback;
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as T;
    } catch (err) {
      console.error(`[JsonStore] failed to read ${this.filePath}:`, err);
      return fallback;
    }
  }

  write(value: T) {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(value, null, 2), "utf-8");
    } catch (err) {
      console.error(`[JsonStore] failed to write ${this.filePath}:`, err);
    }
  }

  clear() {
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath);
    } catch (err) {
      console.error(`[JsonStore] failed to clear ${this.filePath}:`, err);
    }
  }
}

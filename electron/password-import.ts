import { existsSync, mkdtempSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import initSqlJs from "sql.js";
import { userDataDir } from "./bookmark-import";
import type { PasswordImportResult } from "./types";

// Reads Chrome/Edge's own saved passwords and decrypts them, based on the
// same well-documented scheme Chrome itself uses (and that most existing
// "chrome password recovery" tools reverse-engineered years ago):
//
//  - Passwords live in a SQLite database ("Login Data") inside the
//    profile folder, in a `logins` table (origin_url, username_value,
//    password_value BLOB).
//  - password_value is encrypted with a per-OS-profile master key:
//      Windows: the key itself is DPAPI-protected, stored (base64,
//               prefixed "DPAPI") in "Local State" under
//               os_crypt.encrypted_key. Unwrapped via Windows' own
//               CryptUnprotectData — there's no Node/Electron API for
//               that, so this shells out to PowerShell, which can call it
//               directly with no extra dependency. Each password blob is
//               then AES-256-GCM, prefixed "v10"/"v11" + 12-byte nonce +
//               ciphertext + 16-byte tag.
//      macOS:   the key comes from Keychain, item "<Browser> Safe
//               Storage" — reading it prompts the person for their macOS
//               login password (a normal, expected system dialog, not
//               something QueckSilver Arch can or should bypass).
//               PBKDF2(passphrase, "saltysalt", 1003 rounds) → AES-128-CBC
//               key, fixed IV of 16 spaces, blobs prefixed "v10".
//      Linux:   only the common "Basic" storage fallback is supported
//               (hardcoded passphrase "peanuts", same PBKDF2/AES-128-CBC
//               scheme as macOS) — profiles actually protected by GNOME
//               Keyring or KWallet can't be decrypted this way and will
//               correctly fail with an error rather than importing
//               garbage.
//
// IMPORTANT: this has been written carefully against Chrome's publicly
// documented internals, but hasn't been exercised against a real Windows/
// macOS Chrome profile in this environment — please treat the first import
// as something to double-check (e.g. against a profile with only one or
// two throwaway saved logins) rather than trusting it blindly on a
// profile you care about.

type RawLogin = { url: string; username: string; encryptedPassword: Buffer };

export async function importChromiumPasswords(
  browser: "chrome" | "edge",
  profileId: string,
): Promise<PasswordImportResult & { entries: { url: string; username: string; password: string }[] }> {
  const empty = { imported: 0, skipped: 0, entries: [] as { url: string; username: string; password: string }[] };

  const dir = userDataDir(browser);
  if (!dir || !existsSync(path.join(dir, profileId))) {
    return { ...empty, error: "Couldn't find that browser profile." };
  }
  const loginDataPath = path.join(dir, profileId, "Login Data");
  if (!existsSync(loginDataPath)) {
    return { ...empty, error: null }; // profile exists, just has no saved passwords
  }

  let tmpDir: string | null = null;
  try {
    // Chrome keeps this file open (and, on Windows, locked for writing)
    // while running — copying it first avoids fighting over the handle,
    // and means an already-running Chrome doesn't need to be closed.
    tmpDir = mkdtempSync(path.join(tmpdir(), "qs-pwimport-"));
    const copyPath = path.join(tmpDir, "Login Data");
    copyFileSync(loginDataPath, copyPath);

    const key = getMasterKey(browser, dir);
    if (!key) {
      return { ...empty, error: `Couldn't unlock this browser's saved-password storage on this system.${lastKeyError ? ` (${lastKeyError})` : ""}` };
    }

    const rawLogins = await readLogins(copyPath);
    const entries: { url: string; username: string; password: string }[] = [];
    for (const login of rawLogins) {
      if (!login.username) continue; // no login without a username to attach the password to
      const decrypted = decryptValue(login.encryptedPassword, key);
      if (decrypted === null) continue; // skip entries we couldn't decrypt rather than importing garbage
      entries.push({ url: login.url, username: login.username, password: decrypted });
    }

    return { imported: 0, skipped: 0, error: null, entries };
  } catch (err) {
    console.error("[password-import] failed:", err);
    return { ...empty, error: "Something went wrong reading that browser's saved passwords." };
  } finally {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

async function readLogins(sqliteFilePath: string): Promise<RawLogin[]> {
  const SQL = await initSqlJs({
    // __dirname is electron/dist at runtime (this file is bundled into
    // main.cjs there) — sql-wasm.wasm is copied alongside it by
    // scripts/build-electron.mjs specifically so this always resolves,
    // dev or packaged.
    locateFile: (file: string) => path.join(__dirname, file),
  });
  const buffer = readFileSync(sqliteFilePath);
  const db = new SQL.Database(buffer);
  try {
    const result = db.exec("SELECT origin_url, username_value, password_value FROM logins");
    if (result.length === 0) return [];
    const rows = result[0]!.values;
    return rows.map((row) => ({
      url: String(row[0] ?? ""),
      username: String(row[1] ?? ""),
      // sql.js returns BLOB columns as Uint8Array.
      encryptedPassword: Buffer.from(row[2] as Uint8Array),
    }));
  } finally {
    db.close();
  }
}

// --- Master key retrieval, per platform -------------------------------------

// Set by whichever of the getXKey functions below actually ran and failed
// — surfaced in the PasswordImportResult.error so a failure gives an
// actionable reason instead of just "couldn't unlock" every time.
let lastKeyError: string | null = null;

function getMasterKey(browser: "chrome" | "edge", profileParentDir: string): Buffer | null {
  lastKeyError = null;
  if (process.platform === "win32") return getWindowsKey(profileParentDir);
  if (process.platform === "darwin") return getMacKey(browser);
  if (process.platform === "linux") return getLinuxKey();
  lastKeyError = `Unsupported platform: ${process.platform}`;
  return null;
}

function getWindowsKey(profileParentDir: string): Buffer | null {
  try {
    const localStatePath = path.join(profileParentDir, "Local State");
    if (!existsSync(localStatePath)) {
      lastKeyError = "Local State file not found";
      return null;
    }
    const localState = JSON.parse(readFileSync(localStatePath, "utf-8"));
    const encryptedKeyB64: string | undefined = localState?.os_crypt?.encrypted_key;
    if (!encryptedKeyB64) {
      lastKeyError = "no os_crypt.encrypted_key in Local State";
      return null;
    }

    // Stored as base64("DPAPI" + <actual DPAPI blob>) — strip the 5-byte
    // "DPAPI" marker before handing it to CryptUnprotectData.
    const withPrefix = Buffer.from(encryptedKeyB64, "base64");
    const dpapiBlob = withPrefix.subarray(5);
    return unprotectDpapi(dpapiBlob);
  } catch (err) {
    lastKeyError = err instanceof Error ? err.message : String(err);
    console.error("[password-import] failed to read Windows master key:", err);
    return null;
  }
}

// Shells out to PowerShell to call Windows' own DPAPI unprotect — there's
// no Node/Electron binding for CryptUnprotectData, and DPAPI blobs are
// scoped to the current OS user account (not to the app that created
// them), so any process running as that same Windows user is able to call
// this the same way Chrome itself does internally.
function unprotectDpapi(blob: Buffer): Buffer | null {
  try {
    const b64 = blob.toString("base64");
    const script = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64}'), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf-8" }).trim();
    return Buffer.from(out, "base64");
  } catch (err) {
    lastKeyError = err instanceof Error ? err.message : String(err);
    console.error("[password-import] DPAPI unprotect failed:", err);
    return null;
  }
}

function getMacKey(browser: "chrome" | "edge"): Buffer | null {
  try {
    const service = browser === "chrome" ? "Chrome Safe Storage" : "Microsoft Edge Safe Storage";
    // Prompts the person for their macOS account password the first time
    // (a normal Keychain access dialog) — nothing QueckSilver Arch
    // controls or can skip, same as Chrome itself does on first launch.
    const passphrase = execFileSync("security", ["find-generic-password", "-w", "-s", service], { encoding: "utf-8" }).trim();
    return crypto.pbkdf2Sync(passphrase, "saltysalt", 1003, 16, "sha1");
  } catch (err) {
    lastKeyError = err instanceof Error ? err.message : String(err);
    console.error("[password-import] failed to read macOS Keychain key:", err);
    return null;
  }
}

function getLinuxKey(): Buffer {
  // Only covers Chrome's "Basic" (no OS keyring) storage fallback — a
  // profile actually backed by GNOME Keyring or KWallet uses a real
  // per-installation secret this can't reach, and will fail to decrypt
  // (caught in decryptValue below) rather than silently returning garbage.
  return crypto.pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
}

// --- Value decryption --------------------------------------------------------

function decryptValue(encrypted: Buffer, key: Buffer): string | null {
  if (encrypted.length === 0) return null;

  const prefix = encrypted.subarray(0, 3).toString("latin1");
  if (prefix === "v10" || prefix === "v11") {
    const rest = encrypted.subarray(3);
    if (process.platform === "win32") {
      // AES-256-GCM: 12-byte nonce, then ciphertext, then a 16-byte tag at
      // the very end.
      const nonce = rest.subarray(0, 12);
      const tag = rest.subarray(rest.length - 16);
      const ciphertext = rest.subarray(12, rest.length - 16);
      try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
      } catch (err) {
        console.error("[password-import] AES-GCM decrypt failed for one entry:", err);
        return null;
      }
    }
    // macOS/Linux: AES-128-CBC, fixed IV of 16 spaces.
    try {
      const iv = Buffer.alloc(16, " ");
      const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
      return Buffer.concat([decipher.update(rest), decipher.final()]).toString("utf-8");
    } catch (err) {
      console.error("[password-import] AES-CBC decrypt failed for one entry:", err);
      return null;
    }
  }

  // No "v1x" prefix — older Chrome versions on Windows DPAPI-protected
  // each password directly, with no separate AES layer at all.
  if (process.platform === "win32") {
    const direct = unprotectDpapi(encrypted);
    return direct ? direct.toString("utf-8") : null;
  }
  return null;
}

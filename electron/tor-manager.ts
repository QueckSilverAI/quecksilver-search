import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { app } from "electron";

// Real, honest limitation up front: this module drives a genuine `tor`
// binary as a subprocess — it does not implement onion routing itself
// (that's a serious, security-critical protocol implementation, not
// something to hand-roll here). It expects that binary to already exist
// on disk; QueckSilver Arch does not download or bundle it automatically.
// The official, signed binaries are published by the Tor Project at
// https://www.torproject.org/download/tor/ — see resolveTorBinaryPath()
// below for exactly where this looks for it and how to override that.

export type TorStatus =
  | { state: "stopped" }
  | { state: "starting"; bootstrapPercent: number; message: string }
  | { state: "ready"; socksPort: number }
  | { state: "error"; message: string };

const SOCKS_PORT = 9150; // deliberately NOT Tor's default 9050, so this never collides with a real, separately-running Tor install/Tor Browser on the same machine
const CONTROL_PORT = 9151;

// Same directory startTor() below passes as --DataDirectory — hoisted out
// to module scope so requestNewIdentity()'s cookie lookup (readControlAuthCookie)
// can resolve the exact same path without re-deriving it or needing startTor
// to remember/export it separately.
function torDataDir(): string {
  return path.join(app.getPath("userData"), "tor-data");
}

// Tor was started with --CookieAuthentication 1 below, which means the
// control port genuinely REQUIRES this cookie on every AUTHENTICATE — a
// bare "AUTHENTICATE" with no argument gets rejected ("515 Authentication
// failed"), which is exactly what made requestNewIdentity() silently never
// work: SIGNAL NEWNYM was being sent on a connection that never actually
// authenticated, so Tor never granted a fresh circuit, while the person
// saw a "New Identity" confirmation because the OTHER cleanup this ran
// (clearing storage, resetting tabs) still worked regardless.
function readControlAuthCookie(): string | null {
  try {
    const cookiePath = path.join(torDataDir(), "control_auth_cookie");
    if (!existsSync(cookiePath)) return null;
    return readFileSync(cookiePath).toString("hex");
  } catch (err) {
    console.error("[tor] failed to read control_auth_cookie:", err);
    return null;
  }
}

let torProcess: ChildProcess | null = null;
let status: TorStatus = { state: "stopped" };
let statusListeners: ((s: TorStatus) => void)[] = [];

function setStatus(s: TorStatus) {
  status = s;
  for (const listener of statusListeners) listener(s);
}

export function onTorStatusChange(cb: (s: TorStatus) => void): () => void {
  statusListeners.push(cb);
  return () => {
    statusListeners = statusListeners.filter((l) => l !== cb);
  };
}

export function getTorStatus(): TorStatus {
  return status;
}

// Checked in this order: an explicit override (Settings, for someone who
// installed Tor somewhere nonstandard), then a `resources/tor/` folder
// next to the app (where a packaged build could ship one), then the
// system PATH. Returns null if none of those pan out — the caller is
// expected to surface that as a clear "Tor isn't set up" message, not
// crash or silently do nothing.
export function resolveTorBinaryPath(overridePath?: string | null): string | null {
  if (overridePath && existsSync(overridePath)) return overridePath;
  const bundled = path.join(process.resourcesPath ?? app.getAppPath(), "tor", process.platform === "win32" ? "tor.exe" : "tor");
  if (existsSync(bundled)) return bundled;
  return null; // PATH lookup happens implicitly if we just spawn("tor", ...) — handled in startTor's catch below
}

export async function startTor(binaryPathOverride?: string | null): Promise<void> {
  if (torProcess) return; // already running (or starting) — startTor is idempotent
  const resolved = resolveTorBinaryPath(binaryPathOverride);
  const binary = resolved ?? "tor"; // fall through to PATH lookup if nothing was found explicitly

  setStatus({ state: "starting", bootstrapPercent: 0, message: "Starting Tor…" });

  const dataDir = torDataDir();

  try {
    torProcess = spawn(
      binary,
      [
        "--SocksPort", String(SOCKS_PORT),
        "--ControlPort", String(CONTROL_PORT),
        "--CookieAuthentication", "1",
        "--DataDirectory", dataDir,
        // Fresh identity/circuits every app run — nothing about which
        // relays were used should survive a restart, matching "Tor mode
        // never persists anything" the same way the session partition
        // itself doesn't.
        "--AvoidDiskWrites", "1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    torProcess = null;
    setStatus({ state: "error", message: `Couldn't start Tor: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  torProcess.on("error", (err) => {
    // ENOENT specifically means "binary not found at all" (neither the
    // resolved path nor anything on PATH) — worth a distinct, actionable
    // message rather than a raw Node error string.
    const message =
      (err as NodeJS.ErrnoException).code === "ENOENT"
        ? "Tor isn't installed or couldn't be found. Set a custom path in Settings → Privacy → Tor, or install Tor and make sure it's on your PATH."
        : `Tor process error: ${err.message}`;
    setStatus({ state: "error", message });
    torProcess = null;
  });

  torProcess.on("exit", (code) => {
    torProcess = null;
    if (status.state !== "error") {
      setStatus(code === 0 ? { state: "stopped" } : { state: "error", message: `Tor exited unexpectedly (code ${code})` });
    }
  });

  torProcess.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    // Tor's own bootstrap log lines look like:
    // "Bootstrapped 45% (loading_descriptors): Loading relay descriptors"
    const match = text.match(/Bootstrapped (\d+)%[^:]*:\s*(.+)/);
    if (match) {
      const percent = Number(match[1]);
      setStatus({ state: "starting", bootstrapPercent: percent, message: match[2]?.trim() ?? "" });
      if (percent >= 100) setStatus({ state: "ready", socksPort: SOCKS_PORT });
    }
  });
}

export function stopTor() {
  if (torProcess) {
    torProcess.kill();
    torProcess = null;
  }
  setStatus({ state: "stopped" });
}

export function getSocksProxyRule(): string {
  return `socks5://127.0.0.1:${SOCKS_PORT}`;
}

// Sends a raw command to Tor's ControlPort — used by requestNewIdentity
// below. Bare-bones hand-rolled client (a few lines over a raw TCP
// socket) rather than a dependency: the control protocol this actually
// needs (AUTHENTICATE, SIGNAL) is a handful of plain-text line-based
// commands, not worth a whole library for.
function sendControlCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(CONTROL_PORT, "127.0.0.1");
    let buffer = "";
    socket.on("connect", () => socket.write(command + "\r\n"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (/^250[ -]/m.test(buffer)) {
        socket.end();
        resolve(buffer);
      }
    });
    socket.on("error", reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("Tor control port timed out"));
    });
  });
}

// "New identity" — the actual signal Tor Browser's own button sends.
// Forces new circuits for any FUTURE connections; doesn't retroactively
// change ones already in use. Pairing this with also recreating the
// window's session partition (done by the caller, in main.ts) is what
// makes it a genuinely full reset rather than just a new circuit.
export async function requestNewIdentity(): Promise<void> {
  const cookieHex = readControlAuthCookie();
  if (!cookieHex) {
    throw new Error(
      "Couldn't read Tor's control_auth_cookie — is Tor actually running and bootstrapped?",
    );
  }
  await sendControlCommand(`AUTHENTICATE ${cookieHex}\r\nSIGNAL NEWNYM`);
}

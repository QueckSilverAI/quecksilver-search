import type { WebContents } from "electron";

// Shared webContents.debugger lifecycle — see the masterplan's own
// "Architektur-Zusätze" note: several Control center features (#24
// device emulation, #25 element picker, and later #30/#32) all need a
// Chrome DevTools Protocol session on the same tab, and Electron only
// allows ONE debugger attach per WebContents at a time. Every CDP-based
// feature goes through ensureDebuggerAttached/sendCdpCommand here instead
// of calling wc.debugger.attach() itself, so they can share one session
// without stepping on each other.
const attachedIds = new Set<number>();
// Tracks an attach already IN PROGRESS per webContents id. Without this,
// two calls landing close together (e.g. clicking "iPhone" right after
// "iPad" in the Control Center, or device-emulation and the element
// picker firing back to back) can both see attachedIds not-yet-set and
// both call wc.debugger.attach() — the second one throws ("Debugger is
// already attached to the target"), and since attach() itself wasn't
// wrapped in a try/catch below, that throw wasn't going through a clean
// rejection — a plausible source of the reported crash when switching
// device-emulation presets. Callers now all await the SAME in-flight
// attach instead of racing a second one.
const attachingPromises = new Map<number, Promise<void>>();

export async function ensureDebuggerAttached(wc: WebContents): Promise<void> {
  if (attachedIds.has(wc.id) || wc.debugger.isAttached()) {
    attachedIds.add(wc.id);
    return;
  }
  const inFlight = attachingPromises.get(wc.id);
  if (inFlight) return inFlight;

  // Real DevTools already open on this tab uses the one debugger slot
  // Chromium allows per target — attach() would throw here regardless of
  // the race-guard above. Failing clearly and immediately is much better
  // than whatever attach() does when it can't get the slot.
  if (wc.isDevToolsOpened()) {
    throw new Error("Can't use this while DevTools is open on this tab — close DevTools first.");
  }

  const attachPromise = (async () => {
    try {
      wc.debugger.attach("1.3");
      attachedIds.add(wc.id);
      // Real DevTools being opened on the same tab (or the tab navigating
      // to a crashed/closed state) detaches the debugger out from under
      // us — this just keeps the bookkeeping honest so the next call
      // re-attaches instead of assuming a dead session is still live.
      wc.debugger.once("detach", () => attachedIds.delete(wc.id));
    } finally {
      attachingPromises.delete(wc.id);
    }
  })();
  attachingPromises.set(wc.id, attachPromise);
  return attachPromise;
}

export async function sendCdpCommand<T = unknown>(
  wc: WebContents,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  await ensureDebuggerAttached(wc);
  return wc.debugger.sendCommand(method, params) as Promise<T>;
}

export function detachDebugger(wc: WebContents) {
  if (!attachedIds.has(wc.id) && !wc.debugger.isAttached()) return;
  try {
    wc.debugger.detach();
  } catch {
    /* already gone */
  }
  attachedIds.delete(wc.id);
}

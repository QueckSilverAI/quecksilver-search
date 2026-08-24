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

export async function ensureDebuggerAttached(wc: WebContents): Promise<void> {
  if (attachedIds.has(wc.id) || wc.debugger.isAttached()) {
    attachedIds.add(wc.id);
    return;
  }
  wc.debugger.attach("1.3");
  attachedIds.add(wc.id);
  // Real DevTools being opened on the same tab (or the tab navigating to
  // a crashed/closed state) detaches the debugger out from under us —
  // this just keeps the bookkeeping honest so the next call re-attaches
  // instead of assuming a dead session is still live.
  wc.debugger.once("detach", () => attachedIds.delete(wc.id));
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

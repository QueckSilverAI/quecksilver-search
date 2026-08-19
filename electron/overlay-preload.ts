// Deliberately tiny compared to the main chrome UI's preload.ts — the
// overlay renderer never needs tabs/bookmarks/passwords/etc. It only ever
// needs to (a) receive what to render, (b) report the action the person
// picked, (c) report its own measured size, (d) ask to be closed.
import { contextBridge, ipcRenderer } from "electron";
import type { OverlayAction, OverlayInitMessage, OverlaySizeReport } from "./overlay-types";

const overlayAPI = {
  onInit: (cb: (request: OverlayInitMessage) => void): (() => void) => {
    const listener = (_event: unknown, request: OverlayInitMessage) => cb(request);
    ipcRenderer.on("overlay:init", listener);
    return () => ipcRenderer.removeListener("overlay:init", listener);
  },
  sendAction: (action: OverlayAction): void => ipcRenderer.send("overlay:action", action),
  // Same as sendAction, but the main process WON'T close the overlay
  // afterward — see OverlayWindowManager.notifyAction's doc comment.
  notifyAction: (action: OverlayAction): void => ipcRenderer.send("overlay:notify", action),
  reportSize: (size: OverlaySizeReport): void => ipcRenderer.send("overlay:reportSize", size),
  requestClose: (): void => ipcRenderer.send("overlay:requestClose"),
  // Only the bookmark dialog's URL field uses this (see src/overlay/types.ts's
  // BookmarkOverlayPayload comment) — resolved in main.ts against the OWNER
  // window's id (not this overlay window's own, which isn't in the
  // per-window frequent-sites store at all), via OverlayWindowManager's
  // ownerWindowId.
  frequentSites: (prefix: string): Promise<unknown> => ipcRenderer.invoke("overlay:frequentSites", prefix),
};

contextBridge.exposeInMainWorld("overlayAPI", overlayAPI);

export type OverlayAPI = typeof overlayAPI;

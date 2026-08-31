import { useEffect, useRef, useState } from "react";

// Kept in sync by hand with electron/overlay-types.ts's OverlayKind — this
// file lives in the renderer, which never imports electron/ code directly
// (same reasoning as use-browser-api.ts's own hand-duplicated BrowserAPI
// type below it, not importing electron/preload.ts).
export type OverlayKind = "profile" | "contextmenu" | "bookmark" | "groupDialog" | "tabSearch" | "downloads" | "favoriteContextMenu" | "favoriteEditDialog" | "favoriteFolder" | "newFavoriteFolderDialog" | "tabsMenu" | "tabPreview" | "searchEngine";
export type OverlayAction = { kind: OverlayKind; action: unknown };
type OverlayInitRequest = { kind: OverlayKind; payload: unknown };

type OverlayAPI = {
  onInit: (cb: (request: OverlayInitRequest) => void) => () => void;
  sendAction: (action: OverlayAction) => void;
  notifyAction: (action: OverlayAction) => void;
  reportSize: (size: { width: number; height: number }) => void;
  requestClose: () => void;
  // Only the bookmark dialog uses this (see src/overlay/types.ts's
  // BookmarkOverlayPayload comment) — goes straight to the main process
  // instead of round-tripping through the owner window's React state.
  frequentSites: (prefix: string) => Promise<{ domain: string; visitCount: number; lastVisit: number }[]>;
};

declare global {
  interface Window {
    overlayAPI?: OverlayAPI;
  }
}

// Everything the overlay route (src/routes/overlay.tsx) needs to host
// whichever content component a given "kind" renders — receiving its
// payload, reporting its own real size (Phase 2's "content measures
// itself" approach) so the native window resizes to fit, and sending back
// whatever the person picked.
export function useOverlayHost() {
  const [request, setRequest] = useState<OverlayInitRequest | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const api = window.overlayAPI;
    if (!api) return; // e.g. the Lovable web preview, where this route never actually gets opened as a real overlay
    return api.onInit((req) => setRequest(req));
  }, []);

  // Reports the content's real rendered size any time it changes (step
  // changes in ProfilePopup, e.g. "list" vs "name" — different heights) so
  // overlay-window.ts's reportSize can resize the actual native window to
  // match, no fixed/guessed size needed.
  useEffect(() => {
    const el = contentRef.current;
    const api = window.overlayAPI;
    if (!el || !api) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) api.reportSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [request]);

  function sendAction(action: unknown) {
    if (!request) return;
    window.overlayAPI?.sendAction({ kind: request.kind, action });
  }

  // Same as sendAction, but doesn't close the overlay — see
  // overlay-preload.ts's notifyAction doc comment.
  function notifyAction(action: unknown) {
    if (!request) return;
    window.overlayAPI?.notifyAction({ kind: request.kind, action });
  }

  function requestClose() {
    window.overlayAPI?.requestClose();
  }

  function queryFrequentSites(prefix: string): Promise<{ domain: string; visitCount: number; lastVisit: number }[]> {
    return window.overlayAPI?.frequentSites(prefix) ?? Promise.resolve([]);
  }

  return { kind: request?.kind ?? null, payload: request?.payload ?? null, contentRef, sendAction, notifyAction, requestClose, queryFrequentSites };
}

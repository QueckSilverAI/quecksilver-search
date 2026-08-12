import { useCallback, useEffect, useState } from "react";
import type { Bookmark } from "./use-browser-api";

const SLOT_COUNT = 5;
const EMPTY: Bookmark[] = Array(SLOT_COUNT).fill(null);

export function useBookmarks() {
  const api = typeof window !== "undefined" ? window.browserAPI?.bookmarks : undefined;
  const profilesApi = typeof window !== "undefined" ? window.browserAPI?.profiles : undefined;
  const [bookmarks, setBookmarksState] = useState<Bookmark[]>(EMPTY);

  useEffect(() => {
    if (!api) return;
    api.list().then(setBookmarksState);
    const unsubBookmarks = api.onChanged(setBookmarksState);
    // Per-profile now (electron/bookmark-store.ts) — re-fetch on profile
    // switch, same reasoning as use-header-favorites.ts.
    const unsubProfiles = profilesApi?.onChanged(() => {
      api.list().then(setBookmarksState);
    });
    return () => {
      unsubBookmarks();
      unsubProfiles?.();
    };
  }, [api, profilesApi]);

  // Outside Electron there's nothing to persist to — bookmarks just live in
  // React state for the session, same as before this hook existed.
  const setBookmarks = useCallback(
    (updater: Bookmark[] | ((prev: Bookmark[]) => Bookmark[])) => {
      setBookmarksState((prev) => {
        const next = typeof updater === "function" ? (updater as (p: Bookmark[]) => Bookmark[])(prev) : updater;
        api?.save(next);
        return next;
      });
    },
    [api],
  );

  return { bookmarks, setBookmarks };
}

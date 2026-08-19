import { useCallback, useEffect, useState } from "react";
import type { HeaderFavorite } from "./use-browser-api";

// Separate from the 5 fixed home-page bookmark slots (use-bookmarks.ts) —
// this is the growable bookmarks bar shown under the toolbar, like Edge/Chrome.
export function useHeaderFavorites() {
  const api = typeof window !== "undefined" ? window.browserAPI?.headerFavorites : undefined;
  const profilesApi = typeof window !== "undefined" ? window.browserAPI?.profiles : undefined;
  const [favorites, setFavoritesState] = useState<HeaderFavorite[]>([]);

  useEffect(() => {
    if (!api) return;
    api.list().then(setFavoritesState);
    const unsubFavorites = api.onChanged(setFavoritesState);
    // Favorites are per-profile now (electron/favorites-store.ts) — a
    // profile switch means the previously-loaded list belongs to the
    // profile just left, not the one now active, so it needs re-fetching.
    const unsubProfiles = profilesApi?.onChanged(() => {
      api.list().then(setFavoritesState);
    });
    return () => {
      unsubFavorites();
      unsubProfiles?.();
    };
  }, [api, profilesApi]);

  const setFavorites = useCallback(
    (updater: HeaderFavorite[] | ((prev: HeaderFavorite[]) => HeaderFavorite[])) => {
      setFavoritesState((prev) => {
        const next = typeof updater === "function" ? (updater as (p: HeaderFavorite[]) => HeaderFavorite[])(prev) : updater;
        api?.save(next);
        return next;
      });
    },
    [api],
  );

  const add = useCallback(
    (label: string, url: string) => {
      const entry: HeaderFavorite = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label, url };
      setFavorites((prev) => [...prev, entry]);
    },
    [setFavorites],
  );

  // Bulk-append (import from another browser) — entries already have real
  // ids from wherever they came from, unlike add() which mints one.
  const addMany = useCallback(
    (entries: HeaderFavorite[]) => {
      setFavorites((prev) => [...prev, ...entries]);
    },
    [setFavorites],
  );

  const update = useCallback(
    (id: string, patch: Partial<HeaderFavorite>) => {
      setFavorites((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    },
    [setFavorites],
  );

  const remove = useCallback(
    (id: string) => {
      setFavorites((prev) => {
        const target = prev.find((f) => f.id === id);
        // Deleting a folder un-parents its contents back to top-level
        // instead of deleting them too — losing the folder grouping is a
        // much smaller surprise than losing every bookmark inside it.
        if (target?.isFolder) {
          return prev.filter((f) => f.id !== id).map((f) => (f.parentId === id ? { ...f, parentId: null } : f));
        }
        return prev.filter((f) => f.id !== id);
      });
    },
    [setFavorites],
  );

  // "New folder" from the favorites context menu — creates an empty,
  // named folder. Populating it happens separately, by plain-dragging
  // other favorites onto it (see addToFolder below) — matches how the
  // reference (Edge) actually works: create the folder first, then drag
  // things into it, rather than a drag gesture that creates a folder
  // out of thin air by merging two favorites together (that used to be
  // shift+drop here; removed — a person found it too easy to trigger by
  // accident and wanted folder creation to be a deliberate, named step
  // instead).
  const createFolder = useCallback(
    (label: string) => {
      const folder: HeaderFavorite = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label, url: "", isFolder: true };
      setFavorites((prev) => [...prev, folder]);
    },
    [setFavorites],
  );

  // Plain drag (no modifier key) of a favorite directly onto a FOLDER
  // moves it inside — the only way left to populate a folder, now that
  // folder CREATION is its own explicit "New folder" step (createFolder
  // above) rather than something a drag could also trigger. Dropping
  // onto anything that ISN'T a folder is just an ordinary reorder,
  // handled by reorder() below instead.
  const addToFolder = useCallback(
    (draggedId: string, folderId: string) => {
      setFavorites((prev) => (draggedId === folderId ? prev : prev.map((f) => (f.id === draggedId ? { ...f, parentId: folderId } : f))));
    },
    [setFavorites],
  );

  // "Remove from folder" in the favorites context menu — puts a favorite
  // back at the top level without deleting it.
  const removeFromFolder = useCallback(
    (id: string) => {
      setFavorites((prev) => prev.map((f) => (f.id === id ? { ...f, parentId: null } : f)));
    },
    [setFavorites],
  );

  // Drag-reorder the favorites bar itself — dragId moves to sit right
  // before dropId's current position.
  const reorder = useCallback(
    (dragId: string, dropId: string) => {
      setFavorites((prev) => {
        const dragged = prev.find((f) => f.id === dragId);
        if (!dragged) return prev;
        const rest = prev.filter((f) => f.id !== dragId);
        const dropIndex = rest.findIndex((f) => f.id === dropId);
        if (dropIndex === -1) return prev;
        rest.splice(dropIndex, 0, dragged);
        return rest;
      });
    },
    [setFavorites],
  );

  return { favorites, add, addMany, update, remove, reorder, createFolder, addToFolder, removeFromFolder };
}

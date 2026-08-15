import { useCallback, useEffect, useState } from "react";
import type { DownloadItem } from "./use-browser-api";

export function useDownloads() {
  const api = typeof window !== "undefined" ? window.browserAPI?.downloads : undefined;
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [folder, setFolderState] = useState<string>("");

  useEffect(() => {
    if (!api) return;
    api.list().then(setItems);
    api.getFolder().then(setFolderState);
    return api.onChanged(setItems);
  }, [api]);

  const remove = useCallback((id: string) => api?.remove(id), [api]);
  const open = useCallback((filePath: string) => api?.open(filePath), [api]);
  const showInFolder = useCallback((filePath: string) => api?.showInFolder(filePath), [api]);
  const pickFolder = useCallback(async () => {
    const next = await api?.pickFolder();
    if (next) setFolderState(next);
  }, [api]);

  return { items, folder, remove, open, showInFolder, pickFolder };
}

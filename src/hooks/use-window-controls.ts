import { useEffect, useState } from "react";

export function useWindowControls() {
  const api = typeof window !== "undefined" ? window.browserAPI?.window : undefined;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.isMaximized().then(setIsMaximized);
    return api.onStateChanged((state) => setIsMaximized(state.isMaximized));
  }, [api]);

  return {
    isElectron: Boolean(api),
    isMaximized,
    minimize: () => api?.minimize(),
    toggleMaximize: () => api?.toggleMaximize(),
    close: () => api?.close(),
    setFullScreen: (value: boolean) => api?.setFullScreen(value),
    getIsFullscreen: () => api?.isFullscreen() ?? Promise.resolve(false),
    // Relayed F11/Escape presses from real pages (see preload.ts) — a
    // normal window keydown listener never sees these when a tab's native
    // content, not our chrome UI, has keyboard focus.
    onShortcutF11: (cb: () => void) => api?.onShortcutF11(cb) ?? (() => {}),
    onShortcutEscape: (cb: () => void) => api?.onShortcutEscape(cb) ?? (() => {}),
    onShortcutFocusUrlBar: (cb: () => void) => api?.onShortcutFocusUrlBar(cb) ?? (() => {}),
    onShortcutAddFavorite: (cb: () => void) => api?.onShortcutAddFavorite(cb) ?? (() => {}),
    onShortcutOpenPasswordSettings: (cb: () => void) => api?.onShortcutOpenPasswordSettings(cb) ?? (() => {}),
    onFullscreenChanged: (cb: (isFullscreen: boolean) => void) => api?.onFullscreenChanged(cb) ?? (() => {}),
  };
}

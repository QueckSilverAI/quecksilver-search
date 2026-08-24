import { useCallback, useEffect, useState } from "react";

export type ZoraPreset = "autonomous" | "balanced" | "cautious";
export type ToolPermissionMode = "auto" | "ask";
export type ZoraSettings = { preset: ZoraPreset; toolPermissions: Record<string, ToolPermissionMode> };
export type ZoraToolCatalogEntry = { category: string; tier: "read" | "write"; description: string };

const DEFAULT_SETTINGS: ZoraSettings = { preset: "autonomous", toolPermissions: {} };

// Mirrors electron/zora-tool-catalog.ts's ZORA_PRESET_LABELS — kept as a
// small duplicate here (not fetched over IPC) since it's static copy, same
// reasoning as ZoraToolApprovalCard.tsx's TOOL_LABELS.
export const ZORA_PRESET_LABELS: Record<ZoraPreset, { label: string; description: string }> = {
  autonomous: { label: "Autonomous", description: "Every tool runs automatically, no confirmation." },
  balanced: { label: "Balanced", description: "Read-only tools run automatically; anything that changes state asks first." },
  cautious: { label: "Cautious", description: "Almost everything asks first — only listing tabs, reading pages, and web search stay automatic." },
};

export function useZoraSettings() {
  const api = typeof window !== "undefined" ? window.browserAPI?.zora : undefined;
  const [settings, setSettings] = useState<ZoraSettings>(DEFAULT_SETTINGS);
  const [effective, setEffective] = useState<Record<string, ToolPermissionMode>>({});
  const [catalog, setCatalog] = useState<Record<string, ZoraToolCatalogEntry>>({});

  const refresh = useCallback(async () => {
    if (!api) return;
    const [s, eff] = await Promise.all([api.getSettings(), api.getEffectivePermissions()]);
    setSettings(s);
    setEffective(eff);
  }, [api]);

  useEffect(() => {
    if (!api) return;
    api.getToolCatalog().then(setCatalog);
    void refresh();
  }, [api, refresh]);

  const setPreset = useCallback(
    async (preset: ZoraPreset) => {
      if (!api) return;
      setSettings((prev) => ({ ...prev, preset })); // optimistic — feels instant for the chip click
      await api.setPreset(preset);
      await refresh();
    },
    [api, refresh],
  );

  // mode: null clears the override, back to whatever the current preset says.
  const setToolPermission = useCallback(
    async (toolName: string, mode: ToolPermissionMode | null) => {
      if (!api) return;
      await api.setToolPermission(toolName, mode);
      await refresh();
    },
    [api, refresh],
  );

  return { settings, effective, catalog, setPreset, setToolPermission };
}

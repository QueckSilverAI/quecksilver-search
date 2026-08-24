import { JsonStore } from "./json-store";

export type ZoraPreset = "autonomous" | "balanced" | "cautious";
export type ToolPermissionMode = "auto" | "ask";

export type ZoraSettings = {
  preset: ZoraPreset;
  // Per-tool overrides on top of the preset — a tool NOT listed here falls
  // back to whatever the current preset says (see
  // zora-tool-catalog.ts's resolveToolPermission). Empty object = pure
  // preset, no overrides. Flipping the preset does NOT clear this — an
  // override stays sticky across preset changes until the person clears
  // it again, same as any other explicit choice.
  toolPermissions: Record<string, ToolPermissionMode>;
  // zora-browser-integration-plan.md section 5 — off by default. Gates
  // ONLY the see_screen tool (a real screenshot sent to Gemini as an
  // image); the DOM-based tools (get_clickable_elements, click_element,
  // type_text, ...) send structured text, not pixels, so they work
  // regardless of this toggle.
  screenShareEnabled: boolean;
};

const DEFAULTS: ZoraSettings = {
  preset: "autonomous",
  toolPermissions: {},
  screenShareEnabled: false,
};

const store = new JsonStore<ZoraSettings>("zora-settings.json");

export function getZoraSettings(): ZoraSettings {
  const read = store.read(DEFAULTS);
  // Spread over DEFAULTS (not just returning `read` as-is) so a settings
  // file saved before a future field is added still comes back complete
  // instead of leaving that field undefined.
  return { ...DEFAULTS, ...read, toolPermissions: { ...read.toolPermissions } };
}

export function setZoraSettings(patch: Partial<ZoraSettings>): ZoraSettings {
  const next = { ...getZoraSettings(), ...patch };
  store.write(next);
  return next;
}

// null clears the override for that tool (back to "whatever the preset
// says"), rather than pinning it to a specific mode forever.
export function setToolPermission(toolName: string, mode: ToolPermissionMode | null): ZoraSettings {
  const current = getZoraSettings();
  const nextPermissions = { ...current.toolPermissions };
  if (mode === null) delete nextPermissions[toolName];
  else nextPermissions[toolName] = mode;
  return setZoraSettings({ toolPermissions: nextPermissions });
}

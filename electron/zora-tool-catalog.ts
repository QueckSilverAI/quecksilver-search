import type { ZoraPreset, ToolPermissionMode, ZoraSettings } from "./zora-settings-store";

export type ZoraToolTier = "read" | "write";

export type ZoraToolCatalogEntry = {
  category: string;
  tier: ZoraToolTier;
  description: string;
};

// Every tool Zora can currently call, for two consumers: the Settings UI
// (grouped list with search) and resolveToolPermission below ("balanced"
// asks for every "write" tool, auto for every "read" one). Kept as its
// own hand-maintained table rather than derived from browser-tools.ts's
// BROWSER_TOOL_NAMES — the Settings UI needs a human description per tool
// regardless, so there's no real duplication saved by generating this,
// and a tool intentionally left out of the catalog just falls back to
// "write" (see resolveToolPermission's default) rather than silently
// being uncontrollable.
//
// This is the one place that needs a new line whenever browser-tools.ts
// grows a tool (Phase 5/7/8 of zora-browser-integration-plan.md).
export const ZORA_TOOL_CATALOG: Record<string, ZoraToolCatalogEntry> = {
  new_tab: { category: "Tabs & navigation", tier: "write", description: "Opens a new tab" },
  close_tab: { category: "Tabs & navigation", tier: "write", description: "Closes a tab" },
  switch_tab: { category: "Tabs & navigation", tier: "write", description: "Switches to a different tab" },
  list_tabs: { category: "Tabs & navigation", tier: "read", description: "Lists open tabs" },
  open_url: { category: "Tabs & navigation", tier: "write", description: "Navigates a tab to a URL" },
  go_back: { category: "Tabs & navigation", tier: "write", description: "Goes back in history" },
  go_forward: { category: "Tabs & navigation", tier: "write", description: "Goes forward in history" },
  reload_tab: { category: "Tabs & navigation", tier: "write", description: "Reloads a tab" },
  get_current_url: { category: "Tabs & navigation", tier: "read", description: "Reads the current URL" },
  wait_for_load: { category: "Tabs & navigation", tier: "read", description: "Waits for a tab to finish loading" },
  read_page_text: { category: "Read page content", tier: "read", description: "Reads the visible page text" },
  read_page_source: { category: "Read page content", tier: "read", description: "Reads the page's HTML source" },
  extract_links: { category: "Read page content", tier: "read", description: "Lists links on the page" },
  find_in_page: { category: "Read page content", tier: "read", description: "Searches text on the page" },
  click_element: { category: "Interact with page", tier: "write", description: "Clicks an element" },
  type_text: { category: "Interact with page", tier: "write", description: "Types into a field" },
  scroll_page: { category: "Interact with page", tier: "write", description: "Scrolls the page" },
  add_bookmark: { category: "Bookmarks", tier: "write", description: "Saves a bookmark" },
  remove_bookmark: { category: "Bookmarks", tier: "write", description: "Removes a bookmark" },
  get_control_center_state: { category: "Control Center", tier: "read", description: "Reads all Control Center settings" },
  set_control_center_setting: { category: "Control Center", tier: "write", description: "Changes one Control Center setting" },
  run_control_center_tool: { category: "Control Center", tier: "write", description: "Runs a one-off action (screenshot, translate, export, ...)" },
  apply_preset: { category: "Control Center", tier: "write", description: "Applies a bundle of Control Center settings" },
  web_search: { category: "Web search", tier: "read", description: "Searches the web" },
};

// zora-browser-integration-plan.md section 6 — "Cautious" is deliberately
// NOT tier-based like "Balanced": only this small explicit allowlist of
// the most harmless read tools stays automatic, everything else asks —
// including otherwise-"read" tools like get_control_center_state.
const CAUTIOUS_AUTO_ALLOWLIST = new Set([
  "list_tabs",
  "get_current_url",
  "wait_for_load",
  "read_page_text",
  "read_page_source",
  "extract_links",
  "find_in_page",
  "web_search",
]);

// The three presets from the plan:
// - autonomous (default): everything runs automatically.
// - balanced: the original Tier-2/3 proposal as a pre-filled config —
//   read-only tools stay automatic, anything that changes state asks first.
// - cautious: only the small allowlist above stays automatic, everything
//   else — even other read tools — asks.
// An explicit per-tool override in settings.toolPermissions always wins
// over whatever the preset would say.
export function resolveToolPermission(toolName: string, settings: ZoraSettings): ToolPermissionMode {
  const override = settings.toolPermissions[toolName];
  if (override) return override;
  switch (settings.preset) {
    case "autonomous":
      return "auto";
    case "balanced":
      return ZORA_TOOL_CATALOG[toolName]?.tier === "read" ? "auto" : "ask";
    case "cautious":
      return CAUTIOUS_AUTO_ALLOWLIST.has(toolName) ? "auto" : "ask";
    default:
      return "auto";
  }
}

// Bulk version for the Settings UI (show every tool's CURRENT effective
// mode) and for use-zora-chat.ts (one fetch per turn instead of one IPC
// round-trip per tool call).
export function resolveAllToolPermissions(settings: ZoraSettings): Record<string, ToolPermissionMode> {
  const result: Record<string, ToolPermissionMode> = {};
  for (const name of Object.keys(ZORA_TOOL_CATALOG)) result[name] = resolveToolPermission(name, settings);
  return result;
}

export const ZORA_PRESET_LABELS: Record<ZoraPreset, { label: string; description: string }> = {
  autonomous: { label: "Autonomous", description: "Every tool runs automatically, no confirmation." },
  balanced: { label: "Balanced", description: "Read-only tools run automatically; anything that changes state asks first." },
  cautious: { label: "Cautious", description: "Almost everything asks first — only listing tabs, reading pages, and web search stay automatic." },
};

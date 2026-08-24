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
  stop_loading: { category: "Tabs & navigation", tier: "write", description: "Stops a tab from loading" },
  get_current_url: { category: "Tabs & navigation", tier: "read", description: "Reads the current URL" },
  wait_for_load: { category: "Tabs & navigation", tier: "read", description: "Waits for a tab to finish loading" },
  search_web_in_tab: { category: "Tabs & navigation", tier: "write", description: "Runs a web search and loads the results page in a tab" },
  zoom_in: { category: "Tabs & navigation", tier: "write", description: "Zooms in on the page" },
  zoom_out: { category: "Tabs & navigation", tier: "write", description: "Zooms out on the page" },
  reset_zoom: { category: "Tabs & navigation", tier: "write", description: "Resets page zoom to 100%" },
  close_other_tabs: { category: "Tabs & navigation", tier: "write", description: "Closes every tab except the current one" },
  duplicate_tab: { category: "Tabs & navigation", tier: "write", description: "Opens a copy of the current tab" },
  reopen_closed_tab: { category: "Tabs & navigation", tier: "write", description: "Reopens the most recently closed tab" },
  open_split_view: { category: "Tabs & navigation", tier: "write", description: "Opens a URL side-by-side with the current tab" },
  read_page_text: { category: "Read page content", tier: "read", description: "Reads the visible page text" },
  read_page_source: { category: "Read page content", tier: "read", description: "Reads the page's HTML source" },
  extract_links: { category: "Read page content", tier: "read", description: "Lists links on the page" },
  find_in_page: { category: "Read page content", tier: "read", description: "Searches text on the page" },
  get_page_metadata: { category: "Read page content", tier: "read", description: "Reads title, description, and Open Graph tags" },
  extract_table_data: { category: "Read page content", tier: "read", description: "Extracts <table> contents as structured rows" },
  get_clickable_elements: { category: "Interact with page", tier: "read", description: "Lists clickable/interactive elements with selectors and coordinates" },
  click_element: { category: "Interact with page", tier: "write", description: "Clicks an element" },
  click_at: { category: "Interact with page", tier: "write", description: "Clicks at exact pixel coordinates" },
  type_text: { category: "Interact with page", tier: "write", description: "Types into a field" },
  hover_element: { category: "Interact with page", tier: "write", description: "Hovers over an element" },
  select_dropdown_option: { category: "Interact with page", tier: "write", description: "Picks an option in a dropdown" },
  submit_form: { category: "Interact with page", tier: "write", description: "Submits a form (always asks first, regardless of preset)" },
  scroll_page: { category: "Interact with page", tier: "write", description: "Scrolls the page" },
  see_screen: { category: "Interact with page", tier: "write", description: "Takes a screenshot and sees it as an image (only offered when screen sharing is on)" },
  add_bookmark: { category: "Bookmarks", tier: "write", description: "Saves a bookmark" },
  remove_bookmark: { category: "Bookmarks", tier: "write", description: "Removes a bookmark" },
  list_bookmarks: { category: "Bookmarks", tier: "read", description: "Lists saved bookmarks" },
  download_url: { category: "Downloads & history", tier: "write", description: "Downloads a file from a URL" },
  list_downloads: { category: "Downloads & history", tier: "read", description: "Lists recent downloads" },
  open_download: { category: "Downloads & history", tier: "write", description: "Opens a downloaded file" },
  cancel_download: { category: "Downloads & history", tier: "write", description: "Cancels an in-progress download" },
  list_frequent_sites: { category: "Downloads & history", tier: "read", description: "Lists most-visited domains (no page-level history)" },
  get_selected_text: { category: "Selection", tier: "read", description: "Reads the currently selected/highlighted text on the page" },
  scan_for_mixed_content: { category: "Privacy & security", tier: "read", description: "Finds insecure (http://) resources on an https:// page" },
  list_trackers_on_page: { category: "Privacy & security", tier: "read", description: "Lists which trackers were blocked on this page" },
  check_permissions_for_site: { category: "Privacy & security", tier: "read", description: "Shows camera/mic/notification/download permissions for this site" },
  revoke_site_permission: { category: "Privacy & security", tier: "write", description: "Revokes a previously granted site permission" },
  close_duplicate_tabs: { category: "Tabs & navigation", tier: "write", description: "Closes tabs that are open to the same URL" },
  switch_profile: { category: "Account", tier: "write", description: "Switches to a different QueckSilver profile" },
  get_console_errors: { category: "Developer tools", tier: "read", description: "Lists recent JavaScript console errors on the page" },
  validate_form_before_submit: { category: "Interact with page", tier: "read", description: "Checks a form for empty required fields or obviously invalid values" },
  start_focus_timer: { category: "Focus", tier: "write", description: "Turns on focus mode + do-not-disturb for a set number of minutes" },
  undo_last_action: { category: "Zora", tier: "write", description: "Reverts the last Control Center setting or preset Zora changed" },
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

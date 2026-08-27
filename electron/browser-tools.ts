import { shell, session as electronSession } from "electron";
import type { TabManager } from "./tab-manager";
import { listBookmarks, saveBookmarks } from "./bookmark-store";
import { HOME_URL } from "./types";
import type { WindowEntry } from "./main";
import { runControlCenterAction } from "./control-center-actions";
import {
  getControlCenterSettings,
  setControlCenterSettings,
  type ControlCenterSettings,
  type ControlCenterActionRequest,
} from "./control-center-store";
import { CONTROL_CENTER_FIELD_DESCRIPTIONS } from "./control-center-field-descriptions";
import { listDownloads, cancelDownload } from "./downloads-store";
import { listTopFrequentSites } from "./frequent-sites-store";
import { getZoraSettings } from "./zora-settings-store";
import { getActiveIdentity } from "./profile-store";
import { sendCdpCommand } from "./cdp-client";
import { listProfiles, setActiveProfile } from "./profile-store";
import { getTrackerHostnames } from "./tracker-count-store";
import {
  getSitePermission,
  setSitePermission,
  type PermissionKind,
} from "./site-permissions-store";
import { Notification, nativeImage } from "electron";
import { TTS_URL, IMAGE_SEARCH_URL, WEB_SEARCH_URL_URL } from "./supabase-config";
import { listChromiumProfiles, importChromiumBookmarks } from "./bookmark-import";
import { listHeaderFavorites, saveHeaderFavorites } from "./favorites-store";
import { getSearchEngineSetting } from "./search-engine-store";
import { SEARCH_ENGINES } from "../shared/search-engines";

// Every tool returns a short text result — this is what gets fed back to
// Gemini as the functionResponse content, so keep it compact and factual,
// not chatty. Errors are returned as text too (not thrown) so a bad
// selector/tab id becomes a normal conversational turn ("that tab doesn't
// exist anymore") instead of a hard failure. imageBase64 is see_screen's
// one exception — search-chat/index.ts attaches it as an inlineData part
// alongside the text functionResponse, giving Gemini an actual image, not
// just a description of one.
export type ToolResult = { ok: boolean; text: string; imageBase64?: string; audioBase64?: string; audioMimeType?: string };

const MAX_TEXT_CHARS = 6000;

// zora-browser-integration-plan.md section 5 — get_clickable_elements
// scans the page for interactive elements and returns a computed CSS
// selector per element (not a numeric "ref" the plan describes; see the
// comment on get_clickable_elements/click_element/type_text in
// BROWSER_TOOL_NAMES above for why), plus its role, visible text, and
// center coordinates as a click_at fallback. Deliberately capped at 60
// elements and viewport-visible only — a full-page scan of everything
// interactive on a long page would be mostly noise for the model to sift
// through, and be hopelessly slow.
type ClickableElement = { selector: string; role: string; text: string; x: number; y: number };

const GET_CLICKABLE_ELEMENTS_SCRIPT = `(() => {
  const SEL = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [onclick], [tabindex]:not([tabindex="-1"])';
  function cssPath(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    const testId = el.getAttribute("data-testid");
    if (testId) return \`[data-testid="\${testId}"]\`;
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return \`[aria-label="\${ariaLabel}"]\`;
    const path = [];
    let node = el;
    for (let i = 0; i < 4 && node && node !== document.body; i++) {
      let part = node.tagName.toLowerCase();
      if (typeof node.className === "string" && node.className.trim()) {
        const cls = node.className.trim().split(/\\s+/).slice(0, 2).join(".");
        if (cls) part += "." + cls;
      }
      const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName) : [];
      if (siblings.length > 1) part += \`:nth-of-type(\${siblings.indexOf(node) + 1})\`;
      path.unshift(part);
      node = node.parentElement;
    }
    return path.join(" > ");
  }
  return Array.from(document.querySelectorAll(SEL))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
    })
    .slice(0, 60)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 60);
      return {
        selector: cssPath(el),
        role: el.getAttribute("role") || el.tagName.toLowerCase(),
        text,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
      };
    });
})()`;
const MAX_LINKS = 40;

// Which tool names this dispatcher understands. Kept as a Set (not just
// "default case throws") so main.ts can validate before even trying.
export const BROWSER_TOOL_NAMES = new Set([
  "new_tab",
  "close_tab",
  "switch_tab",
  "list_tabs",
  "open_url",
  "go_back",
  "go_forward",
  "reload_tab",
  "get_current_url",
  "read_page_text",
  "read_page_source",
  "extract_links",
  "click_element",
  "type_text",
  "scroll_page",
  "find_in_page",
  "wait_for_load",
  "add_bookmark",
  "remove_bookmark",
  // Phase 5 — Kategorien A, B, C, F, G aus dem Katalog
  // (zora-browser-integration-plan.md Abschnitt 8). Nicht alle Tools aus
  // diesen Kategorien sind dabei — siehe die Kommentare direkt bei den
  // jeweiligen case-Blocks unten für was bewusst ausgelassen wurde und
  // warum (v.a.: kein Pin/Move/History, weil diese Browser-Features
  // selbst noch gar nicht existieren, und einiges was schon 1:1 über
  // run_control_center_tool erreichbar ist).
  "close_other_tabs",
  "duplicate_tab",
  "reopen_closed_tab",
  "open_split_view",
  "stop_loading",
  "search_web_in_tab",
  "zoom_in",
  "zoom_out",
  "reset_zoom",
  "get_page_metadata",
  "extract_table_data",
  "list_bookmarks",
  "download_url",
  "list_downloads",
  "open_download",
  "cancel_download",
  "list_frequent_sites",
  // Category D — Screen-Vision & Interaktion (see
  // zora-browser-integration-plan.md section 5 for the technical
  // reasoning). Deliberately NOT the exact tool set the plan describes —
  // click_element/type_text already exist as CSS-selector-based tools
  // from an earlier phase and work well; rather than replace them with a
  // parallel ref-based mechanism (and the ref-cache staleness problem
  // that comes with it), get_clickable_elements returns a computed CSS
  // selector per element that plugs directly into the EXISTING
  // click_element/type_text — so those two aren't listed again here.
  // click_at, hover_element, select_dropdown_option and submit_form are
  // the genuinely new ones.
  "see_screen",
  // Phase 8 — the realistically buildable slice of categories H-T (see
  // the conversation with Juri from 2026-08-24 for the full breakdown of
  // what's here vs. what needs new infrastructure that doesn't exist yet
  // — TTS/read-aloud, notifications/reminders, price tracking, breach
  // checking, and QueckSilver-account-linked features like memory/sync
  // are NOT in this list for that reason).
  "get_selected_text",
  "scan_for_mixed_content",
  "list_trackers_on_page",
  "check_permissions_for_site",
  "revoke_site_permission",
  "close_duplicate_tabs",
  "switch_profile",
  "get_console_errors",
  "validate_form_before_submit",
  "start_focus_timer",
  "undo_last_action",
  // N — Vorlesen & Barrierefreiheit, O — Proaktive Benachrichtigungen,
  // S — Preise & Shopping (nur das ehrlich Umsetzbare), G — Bildsuche/
  // Fact-Check/Sucher-öffnen-Rest, K — verbleibendes Meta-Tool, Import
  // (siehe zora-browser-integration-plan.md Abschnitt 8 + die
  // Konversation mit Juri vom 2026-08-24 für die Begründung, was hier
  // NICHT drin ist: track_price_history/compare_specs brauchen keine
  // eigenen Tools, siehe Kommentar bei find_coupon_codes).
  "read_page_aloud",
  "stop_reading",
  "increase_reading_size",
  "describe_image",
  "enable_high_contrast_for_page",
  "notify_at_time",
  "notify_when_tab_loads",
  "notify_on_page_condition",
  "image_search",
  "open_search_results",
  "explain_last_action",
  "import_bookmarks_from_browser",
  "get_clickable_elements",
  "click_at",
  "hover_element",
  "select_dropdown_option",
  "submit_form",
  // Category E — Control Center, see zora-browser-integration-plan.md
  // section 8. All four delegate to runControlCenterAction /
  // control-center-store so there's exactly one place that actually
  // applies a setting or runs an action.
  "get_control_center_state",
  "set_control_center_setting",
  "run_control_center_tool",
  "apply_preset",
]);

// undo_last_action (plan section 8, category K "Zora-eigene Werkzeuge") —
// a lightweight, one-step-deep undo log, not a full history stack. Keyed
// by window id since Control Center settings/focus timers are per-window
// anyway; a real "undo the last 10 things" feature would need much more
// bookkeeping than one tool call justifies. Tab closes don't need an
// entry here at all — reopen_closed_tab (Phase 5) already exists as its
// own tool the model can just call directly.
type UndoableAction = { type: "control_center_settings"; previousValues: Partial<ControlCenterSettings> };
const lastUndoable = new Map<number, UndoableAction>();
// start_focus_timer's revert timer, keyed by window id — replacing a
// running timer (calling start_focus_timer again) clears the old one
// first rather than letting two overlapping timers race to turn focus
// mode off.
const focusTimers = new Map<number, ReturnType<typeof setTimeout>>();

// apply_preset combos (plan section 8, category E). Deliberately NOT
// exhaustive/aggressive — e.g. privacy_max leaves imagesDisabled off so the
// preset doesn't quietly break most sites; Juri can retune these values in
// this one place without touching the tool dispatcher.
const CONTROL_CENTER_PRESETS: Record<string, Partial<ControlCenterSettings>> = {
  battery_saver: {
    batterySaverMode: true,
    backgroundTabsThrottled: true,
    unloadBackgroundTabsOnIdle: true,
    autoSuspendMinutes: 10,
  },
  privacy_max: {
    adBlockEnabled: true,
    doNotTrack: true,
    cookiesBlocked: true,
    popupBlock: true,
    dnsOverHttpsEnabled: true,
    dnsOverHttpsProvider: "cloudflare",
    webrtcLeakProtection: true,
    httpsOnlyEnforced: true,
    cookieAutoDelete: true,
  },
  dev_mode: {
    jsErrorOverlayEnabled: true,
  },
};

// For Zora's explain_last_action tool — updated by the thin wrapper below
// after every successful call, so it stays accurate without every single
// case in the switch needing to remember to set it itself.
const lastActionText = new Map<number, string>();

// Full rolling audit log (zora-browser-integration-plan.md section 6's
// "Audit-Log der Tool-Calls sichtbar in der Sidebar" safety layer) — every
// call, success or failure, capped per window so it can't grow forever
// across a long session. Read-only tools ARE included here (unlike
// lastActionText above, which skips them) — an audit log is for "what did
// Zora actually do", and a denied/failed call is exactly the kind of
// thing worth being able to see.
export type AuditLogEntry = { time: number; name: string; args: Record<string, unknown>; ok: boolean; text: string };
const auditLogs = new Map<number, AuditLogEntry[]>();
const MAX_AUDIT_LOG = 50;

export function getAuditLog(windowId: number): AuditLogEntry[] {
  return auditLogs.get(windowId) ?? [];
}

export function clearAuditLog(windowId: number): void {
  auditLogs.delete(windowId);
}

// Names not worth remembering as "the last thing I did" — explain_last_action
// after a string of lookups should describe the last thing that actually
// changed something, not "I read the console errors".
const READ_ONLY_TOOL_NAMES = new Set([
  "list_tabs", "get_current_url", "wait_for_load", "read_page_text", "read_page_source",
  "extract_links", "find_in_page", "get_page_metadata", "extract_table_data",
  "get_clickable_elements", "get_selected_text", "scan_for_mixed_content",
  "list_trackers_on_page", "check_permissions_for_site", "list_bookmarks",
  "list_downloads", "list_frequent_sites", "get_console_errors", "get_control_center_state",
  "validate_form_before_submit", "explain_last_action", "image_search",
]);

function describeToolCall(name: string, args: Record<string, unknown>): string {
  const argsText = Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  return argsText ? `${name}(${argsText})` : `${name}()`;
}

export async function executeBrowserTool(
  ctx: WindowEntry,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const result = await executeBrowserToolInner(ctx, name, args);
  if (result.ok && !READ_ONLY_TOOL_NAMES.has(name)) {
    lastActionText.set(ctx.win.id, describeToolCall(name, args));
  }
  const log = auditLogs.get(ctx.win.id) ?? [];
  log.push({ time: Date.now(), name, args, ok: result.ok, text: result.text });
  if (log.length > MAX_AUDIT_LOG) log.shift();
  auditLogs.set(ctx.win.id, log);
  return result;
}

async function executeBrowserToolInner(
  ctx: WindowEntry,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tabs = ctx.tabs;
  const win = ctx.win;
  try {
    switch (name) {
      case "new_tab": {
        const id = tabs.createTab(typeof args.url === "string" ? args.url : HOME_URL);
        return { ok: true, text: `Opened new tab (id: ${id}).` };
      }
      case "close_tab": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        tabs.closeTab(id);
        return { ok: true, text: `Closed tab ${id}. (Use reopen_closed_tab to undo.)` };
      }
      case "switch_tab": {
        const id = resolveId(tabs, args.tab_id);
        if (!id) return notFound(args.tab_id);
        tabs.switchTab(id);
        return { ok: true, text: `Switched to tab ${id}.` };
      }
      case "list_tabs": {
        const { activeId, tabs: list } = tabs.listTabs();
        const lines = list.map(
          (t) => `${t.id === activeId ? "* " : "- "}${t.id}: ${t.isHome ? "(new tab)" : `${t.title} — ${t.url}`}`,
        );
        return { ok: true, text: lines.join("\n") || "No tabs open." };
      }
      case "open_url": {
        const id = resolveId(tabs, args.tab_id) ?? tabs.getActiveId();
        const url = typeof args.url === "string" ? args.url : null;
        if (!id) return { ok: false, text: "No active tab to navigate." };
        if (!url) return { ok: false, text: "Missing url." };
        // navigate() now awaits an async Safe Browsing check before it
        // ever calls loadURL() - without awaiting it here too,
        // waitForLoad() below could start polling before loadURL() has
        // even been called yet.
        await tabs.navigate(id, url);
        await tabs.waitForLoad(id);
        return { ok: true, text: `Navigated tab ${id} to ${url}.` };
      }
      case "go_back": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        tabs.goBack(id);
        return { ok: true, text: "Went back." };
      }
      case "go_forward": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        tabs.goForward(id);
        return { ok: true, text: "Went forward." };
      }
      case "reload_tab": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        tabs.reload(id, args.hard === true);
        await tabs.waitForLoad(id);
        return { ok: true, text: args.hard ? "Reloaded without cache." : "Reloaded." };
      }
      case "stop_loading": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        wc.stop();
        return { ok: true, text: "Stopped loading." };
      }
      case "get_current_url": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        const wc = tabs.getWebContents(id);
        return { ok: true, text: wc?.getURL() || HOME_URL };
      }
      case "read_page_text": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const text = await wc.executeJavaScript("document.body ? document.body.innerText : ''", true);
        return { ok: true, text: truncate(String(text ?? "")) };
      }
      case "read_page_source": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const html = await wc.executeJavaScript("document.documentElement ? document.documentElement.outerHTML : ''", true);
        return { ok: true, text: truncate(String(html ?? "")) };
      }
      case "extract_links": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const links = (await wc.executeJavaScript(
          `Array.from(document.querySelectorAll('a[href]')).slice(0, ${MAX_LINKS}).map(a => ({ text: (a.innerText || '').trim().slice(0, 80), href: a.href }))`,
          true,
        )) as Array<{ text: string; href: string }>;
        const lines = links.map((l) => `${l.text || "(no text)"} -> ${l.href}`);
        return { ok: true, text: lines.join("\n") || "No links found." };
      }
      case "click_element": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const selector = typeof args.selector === "string" ? args.selector : null;
        if (!selector) return { ok: false, text: "Missing selector." };
        const clicked = await wc.executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; })()`,
          true,
        );
        return clicked
          ? { ok: true, text: `Clicked ${selector}.` }
          : { ok: false, text: `No element matched selector ${selector}.` };
      }
      case "type_text": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const selector = typeof args.selector === "string" ? args.selector : null;
        const text = typeof args.text === "string" ? args.text : null;
        if (!selector || text === null) return { ok: false, text: "Missing selector or text." };
        const typed = await wc.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return false;
            el.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
              || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
            if (setter) setter.call(el, ${JSON.stringify(text)}); else el.value = ${JSON.stringify(text)};
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          })()`,
          true,
        );
        return typed
          ? { ok: true, text: `Typed into ${selector}.` }
          : { ok: false, text: `No element matched selector ${selector}.` };
      }
      case "scroll_page": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const direction = args.direction === "up" ? -1 : 1;
        await wc.executeJavaScript(`window.scrollBy(0, ${direction} * Math.round(window.innerHeight * 0.8))`, true);
        return { ok: true, text: "Scrolled." };
      }
      case "find_in_page": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const query = typeof args.query === "string" ? args.query : null;
        if (!query) return { ok: false, text: "Missing query." };
        const found = await new Promise<boolean>((resolve) => {
          const onResult = (_e: unknown, result: { matches: number }) => {
            wc.removeListener("found-in-page", onResult as never);
            resolve(result.matches > 0);
          };
          wc.on("found-in-page", onResult as never);
          wc.findInPage(query);
          setTimeout(() => resolve(false), 3000);
        });
        return { ok: found, text: found ? `Found "${query}" on the page.` : `"${query}" not found on the page.` };
      }
      case "wait_for_load": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        await tabs.waitForLoad(id);
        return { ok: true, text: "Page finished loading." };
      }
      case "search_web_in_tab": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return { ok: false, text: "Missing query." };
        // Uses the person's actual chosen search engine now (was
        // hardcoded to Google) — search-engine-store.ts is the same
        // main-process source of truth the URL bar itself reads from.
        const engineId = getSearchEngineSetting();
        const engine = SEARCH_ENGINES.find((e) => e.id === engineId) ?? SEARCH_ENGINES[0]!;
        const url = engine.buildUrl(query);
        const id = resolveId(tabs, args.tab_id) ?? tabs.getActiveId();
        if (!id) {
          tabs.createTab(url);
          return { ok: true, text: `Opened a search for "${query}" in a new tab.` };
        }
        await tabs.navigate(id, url);
        await tabs.waitForLoad(id);
        return { ok: true, text: `Searched for "${query}".` };
      }
      case "zoom_in":
      case "zoom_out":
      case "reset_zoom": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const next =
          name === "reset_zoom"
            ? 1
            : name === "zoom_in"
              ? Math.min(2, Math.round((wc.getZoomFactor() + 0.1) * 10) / 10)
              : Math.max(0.5, Math.round((wc.getZoomFactor() - 0.1) * 10) / 10);
        wc.setZoomFactor(next);
        return { ok: true, text: `Zoomed to ${Math.round(next * 100)}%.` };
      }
      case "close_other_tabs": {
        const { activeId, tabs: list } = tabs.listTabs();
        let closed = 0;
        for (const t of list) {
          if (t.id !== activeId) {
            tabs.closeTab(t.id);
            closed++;
          }
        }
        return { ok: true, text: `Closed ${closed} other tab${closed === 1 ? "" : "s"}.` };
      }
      case "duplicate_tab": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        const wc = tabs.getWebContents(id);
        const url = wc?.getURL() || HOME_URL;
        const newId = tabs.createTab(url);
        return { ok: true, text: `Duplicated the tab (new tab id: ${newId}).` };
      }
      case "reopen_closed_tab": {
        tabs.reopenLastClosedTab();
        return { ok: true, text: "Reopened the most recently closed tab, if there was one." };
      }
      case "open_split_view": {
        const url = typeof args.url === "string" ? args.url : null;
        if (!url) return { ok: false, text: "Missing url." };
        // createTab() switches to the tab it just made, but enterSplit(id)
        // requires id !== the CURRENT active tab (it puts `id` on the right
        // half alongside whatever's active) — so the original tab has to
        // be made active again before calling it, or this silently no-ops.
        const originalActiveId = tabs.getActiveId();
        const newId = tabs.createTab(url);
        if (originalActiveId) tabs.switchTab(originalActiveId);
        tabs.enterSplit(newId);
        return { ok: true, text: `Opened ${url} in split view.` };
      }
      case "get_page_metadata": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        const meta = await tabs.getPageMetadata(id);
        return meta ? { ok: true, text: truncate(JSON.stringify(meta)) } : { ok: false, text: "Couldn't read page metadata." };
      }
      case "extract_table_data": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const tables = (await wc.executeJavaScript(
          `Array.from(document.querySelectorAll("table")).slice(0, 5).map(table =>
            Array.from(table.querySelectorAll("tr")).map(tr =>
              Array.from(tr.querySelectorAll("th,td")).map(cell => cell.innerText.trim())
            )
          )`,
          true,
        )) as string[][][];
        return tables.length > 0
          ? { ok: true, text: truncate(JSON.stringify(tables)) }
          : { ok: false, text: "No tables found on this page." };
      }
      case "list_bookmarks": {
        const current = listBookmarks(win.id);
        const lines = current.filter((b): b is NonNullable<typeof b> => !!b).map((b) => `${b.label} — ${b.url}`);
        return { ok: true, text: lines.join("\n") || "No bookmarks saved." };
      }
      case "download_url": {
        const url = typeof args.url === "string" ? args.url : null;
        if (!url) return { ok: false, text: "Missing url." };
        // ctx.contentSession (falling back to the default session for a
        // normal window) — NOT win.webContents, which is always the chrome
        // UI's own default-session webContents regardless of window mode.
        // Same Tor-proxy-bypass/Incognito-cookie-leak reasoning as
        // main.ts's saveImageDirect/saveLinkAs.
        (ctx.contentSession ?? electronSession.defaultSession).downloadURL(url);
        return { ok: true, text: `Started downloading ${url}.` };
      }
      case "list_downloads": {
        const items = listDownloads();
        const lines = items.slice(0, 20).map((d) => `${d.id}: ${d.filename} — ${d.state} (${d.receivedBytes}/${d.totalBytes || "?"} bytes)`);
        return { ok: true, text: lines.join("\n") || "No downloads yet." };
      }
      case "open_download": {
        const id = typeof args.id === "string" ? args.id : null;
        if (!id) return { ok: false, text: "Missing id." };
        const item = listDownloads().find((d) => d.id === id);
        if (!item) return { ok: false, text: `No download with id ${id}.` };
        const err = await shell.openPath(item.path);
        return err ? { ok: false, text: `Couldn't open the file: ${err}` } : { ok: true, text: `Opened ${item.filename}.` };
      }
      case "cancel_download": {
        const id = typeof args.id === "string" ? args.id : null;
        if (!id) return { ok: false, text: "Missing id." };
        return cancelDownload(id)
          ? { ok: true, text: "Cancelled." }
          : { ok: false, text: "That download isn't in progress (already finished, or unknown id)." };
      }
      case "list_frequent_sites": {
        const sites = listTopFrequentSites(win.id);
        const lines = sites.map((s) => `${s.domain} (visited ${s.visitCount}x)`);
        return { ok: true, text: lines.join("\n") || "Not enough browsing yet to have frequent sites." };
      }
      case "get_clickable_elements": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const elements = (await wc.executeJavaScript(GET_CLICKABLE_ELEMENTS_SCRIPT, true)) as ClickableElement[];
        return elements.length > 0
          ? { ok: true, text: truncate(JSON.stringify(elements)) }
          : { ok: false, text: "No clickable elements found on the visible part of this page." };
      }
      case "click_at": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const x = Number(args.x);
        const y = Number(args.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, text: "Missing or invalid x/y." };
        await sendCdpCommand(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await sendCdpCommand(wc, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await sendCdpCommand(wc, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        return { ok: true, text: `Clicked at (${x}, ${y}).` };
      }
      case "hover_element": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const selector = typeof args.selector === "string" ? args.selector : null;
        if (!selector) return { ok: false, text: "Missing selector." };
        const hovered = (await wc.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return false;
            el.scrollIntoView({ block: "center" });
            const r = el.getBoundingClientRect();
            const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
            el.dispatchEvent(new MouseEvent("mouseover", opts));
            el.dispatchEvent(new MouseEvent("mouseenter", opts));
            el.dispatchEvent(new MouseEvent("mousemove", opts));
            return true;
          })()`,
          true,
        )) as boolean;
        return hovered ? { ok: true, text: `Hovered ${selector}.` } : { ok: false, text: `No element matched selector ${selector}.` };
      }
      case "select_dropdown_option": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const selector = typeof args.selector === "string" ? args.selector : null;
        const value = typeof args.value === "string" ? args.value : null;
        if (!selector || value === null) return { ok: false, text: "Missing selector or value." };
        const selected = (await wc.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el || el.tagName !== "SELECT") return false;
            el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("input", { bubbles: true }));
            return el.value === ${JSON.stringify(value)};
          })()`,
          true,
        )) as boolean;
        return selected
          ? { ok: true, text: `Selected "${value}" in ${selector}.` }
          : { ok: false, text: `Couldn't select "${value}" in ${selector} — check the selector and that the value exists as an <option>.` };
      }
      case "submit_form": {
        // Always asks for confirmation regardless of preset/override — see
        // requiresApproval() in src/hooks/use-zora-chat.ts. Called out
        // specifically in zora-browser-integration-plan.md's category D
        // table as needing that, unlike the rest of this category.
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const selector = typeof args.selector === "string" ? args.selector : null;
        if (!selector) return { ok: false, text: "Missing selector." };
        const submitted = (await wc.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return false;
            const form = el.tagName === "FORM" ? el : el.closest("form");
            if (!form) return false;
            if (form.requestSubmit) form.requestSubmit(); else form.submit();
            return true;
          })()`,
          true,
        )) as boolean;
        return submitted ? { ok: true, text: "Submitted the form." } : { ok: false, text: `No form found for selector ${selector}.` };
      }
      case "see_screen": {
        const settings = getZoraSettings();
        if (!settings.screenShareEnabled) {
          return { ok: false, text: "Screen sharing is off — the person needs to turn it on in the Zora sidebar before I can see a screenshot." };
        }
        // Tor windows never allow screenshots, regardless of the toggle —
        // zora-browser-integration-plan.md section 6's extra safety layer.
        if (getActiveIdentity(win.id).windowMode === "tor") {
          return { ok: false, text: "Screenshots are disabled in Tor windows." };
        }
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        const imageBase64 = await tabs.captureScreenshotBase64(id);
        return imageBase64
          ? { ok: true, text: "Screenshot captured.", imageBase64 }
          : { ok: false, text: "Couldn't capture a screenshot." };
      }
      case "get_selected_text": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const selected = (await wc.executeJavaScript(
          "window.getSelection ? window.getSelection().toString() : ''",
          true,
        )) as string;
        return selected.trim()
          ? { ok: true, text: truncate(selected) }
          : { ok: false, text: "Nothing is currently selected on the page." };
      }
      case "scan_for_mixed_content": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        if (!wc.getURL().startsWith("https://")) {
          return { ok: false, text: "This page isn't loaded over HTTPS, so mixed content doesn't apply." };
        }
        const insecure = (await wc.executeJavaScript(
          `Array.from(document.querySelectorAll("img[src],script[src],link[href],iframe[src]"))
            .map((el) => el.src || el.href)
            .filter((url) => url && url.startsWith("http://"))
            .slice(0, 30)`,
          true,
        )) as string[];
        return insecure.length > 0
          ? { ok: true, text: `Found ${insecure.length} insecure resource(s):\n${insecure.join("\n")}` }
          : { ok: true, text: "No mixed content found — every resource loads over HTTPS." };
      }
      case "list_trackers_on_page": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const names = getTrackerHostnames(wc.id);
        return names.length > 0
          ? { ok: true, text: names.join("\n") }
          : { ok: true, text: "No trackers blocked on this page (or ad blocking is off)." };
      }
      case "check_permissions_for_site": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        let domain: string;
        try {
          domain = new URL(wc.getURL()).hostname;
        } catch {
          return { ok: false, text: "Couldn't determine this page's domain." };
        }
        const entry = getSitePermission(win.id, domain);
        return entry
          ? {
              ok: true,
              text: `${domain}: camera=${entry.camera}, microphone=${entry.microphone}, notifications=${entry.notifications}, autoDownloads=${entry.autoDownloads}`,
            }
          : { ok: true, text: `No permissions have been granted or explicitly blocked for ${domain} yet.` };
      }
      case "revoke_site_permission": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const kind = typeof args.kind === "string" ? (args.kind as PermissionKind) : null;
        if (!kind || !["camera", "microphone", "notifications", "autoDownloads"].includes(kind)) {
          return { ok: false, text: "kind must be one of: camera, microphone, notifications, autoDownloads." };
        }
        let domain: string;
        try {
          domain = new URL(wc.getURL()).hostname;
        } catch {
          return { ok: false, text: "Couldn't determine this page's domain." };
        }
        setSitePermission(win.id, domain, kind, "block");
        return { ok: true, text: `Revoked ${kind} for ${domain}.` };
      }
      case "close_duplicate_tabs": {
        const { activeId, tabs: list } = tabs.listTabs();
        const seen = new Set<string>();
        let closed = 0;
        for (const t of list) {
          if (t.id === activeId) {
            seen.add(t.url);
            continue;
          }
          if (seen.has(t.url)) {
            tabs.closeTab(t.id);
            closed++;
          } else {
            seen.add(t.url);
          }
        }
        return { ok: true, text: closed > 0 ? `Closed ${closed} duplicate tab${closed === 1 ? "" : "s"}.` : "No duplicate tabs found." };
      }
      case "switch_profile": {
        const name = typeof args.name === "string" ? args.name.trim().toLowerCase() : "";
        if (!name) return { ok: false, text: "Missing name." };
        const profiles = listProfiles();
        const profile = profiles.find((p) => p.name.toLowerCase() === name);
        if (!profile) {
          return { ok: false, text: `No profile named "${args.name}". Available: ${profiles.map((p) => p.name).join(", ") || "none"}.` };
        }
        setActiveProfile(win, profile.id);
        return { ok: true, text: `Switched to profile "${profile.name}".` };
      }
      case "get_console_errors": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        const errors = tabs.getConsoleErrors(id);
        return errors.length > 0
          ? { ok: true, text: errors.map((e) => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.message}`).join("\n") }
          : { ok: true, text: "No console errors on this page." };
      }
      case "validate_form_before_submit": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const selector = typeof args.selector === "string" ? args.selector : null;
        if (!selector) return { ok: false, text: "Missing selector." };
        const result = (await wc.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const form = el.tagName === "FORM" ? el : el.closest("form");
            if (!form) return null;
            const problems = [];
            for (const field of form.querySelectorAll("input,select,textarea")) {
              if (field.required && !field.value) problems.push((field.name || field.id || field.type) + " is empty");
              else if (field.type === "email" && field.value && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(field.value)) problems.push((field.name || field.id) + " doesn't look like a valid email");
            }
            return problems;
          })()`,
          true,
        )) as string[] | null;
        if (result === null) return { ok: false, text: `No form found for selector ${selector}.` };
        return result.length > 0
          ? { ok: true, text: `Found ${result.length} issue(s): ${result.join("; ")}` }
          : { ok: true, text: "No obvious issues found." };
      }
      case "start_focus_timer": {
        const minutes = Number(args.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0) return { ok: false, text: "Missing or invalid minutes." };
        const existing = focusTimers.get(win.id);
        if (existing) clearTimeout(existing);
        setControlCenterSettings({ focusMode: true, doNotDisturb: true });
        const timer = setTimeout(() => {
          setControlCenterSettings({ focusMode: false, doNotDisturb: false });
          focusTimers.delete(win.id);
        }, minutes * 60_000);
        focusTimers.set(win.id, timer);
        return { ok: true, text: `Focus mode on for ${minutes} minute${minutes === 1 ? "" : "s"}.` };
      }
      case "undo_last_action": {
        const action = lastUndoable.get(win.id);
        if (!action) {
          return { ok: false, text: "Nothing to undo — either nothing's been changed yet, or it's already been undone." };
        }
        lastUndoable.delete(win.id);
        setControlCenterSettings(action.previousValues);
        return {
          ok: true,
          text: `Reverted: ${Object.entries(action.previousValues).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}.`,
        };
      }
      case "explain_last_action": {
        const description = lastActionText.get(win.id);
        return description
          ? { ok: true, text: description }
          : { ok: true, text: "I haven't done anything in this window yet this session." };
      }
      case "read_page_aloud": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const pageText = String((await wc.executeJavaScript("document.body ? document.body.innerText : ''", true)) ?? "").trim();
        if (!pageText) return { ok: false, text: "No readable text on this page." };
        try {
          const resp = await fetch(TTS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: pageText.slice(0, 5000), language: "English" }),
          });
          if (!resp.ok || !resp.body) return { ok: false, text: "Text-to-speech request failed." };
          // Newline-delimited JSON chunks — {audioB64, mimeType} for each
          // piece of audio as it's synthesized, or a terminal {error}. All
          // chunks share one mimeType (raw PCM) so concatenating the
          // decoded bytes and re-encoding once is correct — there's no
          // per-chunk framing/header to strip.
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          const audioChunks: Buffer[] = [];
          let mimeType = "audio/L16;rate=24000";
          let sawError: string | null = null;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (!line.trim()) continue;
              try {
                const obj = JSON.parse(line);
                if (obj.error) sawError = obj.error;
                else if (obj.audioB64) {
                  audioChunks.push(Buffer.from(obj.audioB64, "base64"));
                  if (obj.mimeType) mimeType = obj.mimeType;
                }
              } catch {
                /* partial/malformed line, skip */
              }
            }
          }
          if (audioChunks.length === 0) return { ok: false, text: sawError ?? "No audio returned." };
          const combined = Buffer.concat(audioChunks).toString("base64");
          // Playback happens locally in the renderer (see use-zora-chat.ts)
          // — this audio is for the person to hear, never sent back to
          // Gemini as input, unlike see_screen's imageBase64.
          return { ok: true, text: "Reading the page aloud now.", audioBase64: combined, audioMimeType: mimeType };
        } catch {
          return { ok: false, text: "Text-to-speech request failed." };
        }
      }
      case "stop_reading": {
        win.webContents.send("zora:stopReading");
        return { ok: true, text: "Stopped reading." };
      }
      case "increase_reading_size": {
        // Reuses the tab zoom mechanism (same one zoom_in uses) rather
        // than reaching into reader-mode-injector.ts's self-contained
        // injected script — genuinely bigger text either way, and this
        // works whether or not reader mode is even on.
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const next = Math.min(2, Math.round((wc.getZoomFactor() + 0.15) * 100) / 100);
        wc.setZoomFactor(next);
        return { ok: true, text: `Increased text size (zoomed to ${Math.round(next * 100)}%).` };
      }
      case "describe_image": {
        const settings = getZoraSettings();
        if (!settings.screenShareEnabled) {
          return { ok: false, text: "Screen sharing is off — the person needs to turn it on in the Zora sidebar before I can look at an image." };
        }
        if (getActiveIdentity(win.id).windowMode === "tor") {
          return { ok: false, text: "Screenshots are disabled in Tor windows." };
        }
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        const selector = typeof args.selector === "string" ? args.selector : null;
        if (!selector) return { ok: false, text: "Missing selector." };
        const rect = (await wc.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            el.scrollIntoView({ block: "center" });
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
          })()`,
          true,
        )) as { x: number; y: number; width: number; height: number } | null;
        if (!rect || rect.width < 1 || rect.height < 1) return { ok: false, text: `No image found for selector ${selector}.` };
        const image = await wc.capturePage(rect).catch(() => null);
        if (!image) return { ok: false, text: "Couldn't capture that image." };
        return { ok: true, text: "Here's the image.", imageBase64: image.toPNG().toString("base64") };
      }
      case "enable_high_contrast_for_page": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        let domain: string;
        try {
          domain = new URL(wc.getURL()).hostname;
        } catch {
          return { ok: false, text: "Couldn't determine this page's domain." };
        }
        // Reuses the same per-domain custom-CSS mechanism as set_custom_css
        // (run_control_center_tool) — scoped to just this domain, not the
        // global visionFilter control-center setting, per the plan's own
        // "gezielt für diese eine Seite, nicht global".
        tabs.setCustomCssForDomain(domain, "html { filter: contrast(1.6) !important; }");
        return { ok: true, text: `High contrast enabled for ${domain}.` };
      }
      case "notify_at_time": {
        const text = typeof args.text === "string" ? args.text : "";
        const minutes = Number(args.minutes);
        if (!text || !Number.isFinite(minutes) || minutes <= 0) return { ok: false, text: "Missing or invalid text/minutes." };
        setTimeout(() => {
          new Notification({ title: "QueckSilver Arch", body: text }).show();
        }, minutes * 60_000);
        return { ok: true, text: `I'll remind you in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
      }
      case "notify_when_tab_loads": {
        const id = requireId(tabs, args.tab_id);
        if (!id) return noActiveTab();
        const wc = tabs.getWebContents(id);
        if (!wc) return notFound(id);
        const title = wc.getTitle() || id;
        wc.once("did-stop-loading", () => {
          new Notification({ title: "QueckSilver Arch", body: `"${title}" finished loading.` }).show();
        });
        return { ok: true, text: `I'll let you know when that tab finishes loading.` };
      }
      case "notify_on_page_condition": {
        const wc = requireWebContents(tabs, args.tab_id);
        if (!wc) return noActiveTab();
        // "contains:text" / "!contains:text" — the simplest protocol that
        // covers both directions the plan's own example needs ("tell me
        // when 'Sold out' disappears" is just the negated form of "tell me
        // when 'In stock' appears").
        const selector = typeof args.selector === "string" ? args.selector : null;
        const condition = typeof args.condition === "string" ? args.condition : null;
        if (!selector || !condition) return { ok: false, text: "Missing selector or condition." };
        const negate = condition.startsWith("!");
        const needle = (negate ? condition.slice(1) : condition).replace(/^contains:/, "");
        let elapsed = 0;
        const maxMs = 30 * 60_000;
        const intervalMs = 5000;
        const timer = setInterval(async () => {
          elapsed += intervalMs;
          if (wc.isDestroyed() || elapsed >= maxMs) {
            clearInterval(timer);
            return;
          }
          const text = (await wc
            .executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerText : null; })()`, true)
            .catch(() => null)) as string | null;
          if (text === null) return;
          const matches = text.includes(needle);
          if (matches !== negate) {
            clearInterval(timer);
            new Notification({ title: "QueckSilver Arch", body: `Condition met on the page you asked about.` }).show();
          }
        }, intervalMs);
        return { ok: true, text: `Watching the page — I'll notify you within the next 30 minutes if that condition is met.` };
      }
      case "image_search": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return { ok: false, text: "Missing query." };
        try {
          const resp = await fetch(IMAGE_SEARCH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          const data = (await resp.json()) as { images?: string[] };
          const images = data.images ?? [];
          return images.length > 0
            ? { ok: true, text: images.join("\n") }
            : { ok: false, text: "No images found." };
        } catch {
          return { ok: false, text: "Image search failed." };
        }
      }
      case "open_search_results": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return { ok: false, text: "Missing query." };
        try {
          const resp = await fetch(WEB_SEARCH_URL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          const data = (await resp.json()) as { url?: string | null; title?: string | null };
          if (!data.url) return { ok: false, text: "No results found." };
          tabs.createTab(data.url);
          return { ok: true, text: `Opened "${data.title ?? data.url}".` };
        } catch {
          return { ok: false, text: "Search failed." };
        }
      }
      case "import_bookmarks_from_browser": {
        const browser = args.browser === "edge" ? "edge" : args.browser === "chrome" ? "chrome" : null;
        if (!browser) return { ok: false, text: 'browser must be "chrome" or "edge".' };
        const profiles = listChromiumProfiles(browser);
        if (profiles.length === 0) return { ok: false, text: `No ${browser} profiles found on this computer.` };
        const profile = profiles.find((p) => p.name.toLowerCase() === "default") ?? profiles[0]!;
        const imported = importChromiumBookmarks(browser, profile.id);
        if (!imported || imported.length === 0) return { ok: false, text: `No bookmarks found in ${browser}'s "${profile.name}" profile.` };
        const current = listHeaderFavorites(win.id);
        const existingUrls = new Set(current.map((f) => f.url));
        const toAdd = imported.filter((f) => !existingUrls.has(f.url));
        saveHeaderFavorites(win.id, [...current, ...toAdd]);
        return { ok: true, text: `Imported ${toAdd.length} bookmark(s) from ${browser} ("${profile.name}" profile). ${imported.length - toAdd.length} were already saved.` };
      }
      case "add_bookmark": {
        const label = typeof args.label === "string" ? args.label.trim() : "";
        const url = typeof args.url === "string" ? args.url.trim() : "";
        if (!label || !url) return { ok: false, text: "Missing label or url." };
        const current = listBookmarks(win.id);
        const emptyIndex = current.findIndex((b) => !b);
        if (emptyIndex === -1) return { ok: false, text: "All 5 bookmark slots are full." };
        current[emptyIndex] = { label, url };
        saveBookmarks(win.id, current);
        win.webContents.send("bookmarks:changed", current);
        return { ok: true, text: `Bookmarked "${label}".` };
      }
      case "remove_bookmark": {
        const label = typeof args.label === "string" ? args.label.trim().toLowerCase() : "";
        if (!label) return { ok: false, text: "Missing label." };
        const current = listBookmarks(win.id);
        const index = current.findIndex((b) => b?.label.toLowerCase() === label);
        if (index === -1) return { ok: false, text: `No bookmark named "${args.label}".` };
        current[index] = null;
        saveBookmarks(win.id, current);
        win.webContents.send("bookmarks:changed", current);
        return { ok: true, text: `Removed bookmark "${args.label}".` };
      }
      case "get_control_center_state": {
        const settings = getControlCenterSettings();
        const lines = (Object.keys(settings) as (keyof ControlCenterSettings)[]).map((key) => {
          const desc = CONTROL_CENTER_FIELD_DESCRIPTIONS[key];
          return `${key} (${desc.category}) = ${JSON.stringify(settings[key])} — ${desc.description}`;
        });
        return { ok: true, text: lines.join("\n") };
      }
      case "set_control_center_setting": {
        const key = typeof args.key === "string" ? (args.key as keyof ControlCenterSettings) : null;
        if (!key || !(key in CONTROL_CENTER_FIELD_DESCRIPTIONS)) {
          return { ok: false, text: `Unknown control center field: ${String(args.key)}` };
        }
        const coerced = coerceControlCenterValue(key, args.value);
        if (!coerced.ok) return { ok: false, text: coerced.error };
        const desc = CONTROL_CENTER_FIELD_DESCRIPTIONS[key];
        // Note: the Control Center dropdown re-fetches via controlCenter.get()
        // whenever it's opened rather than listening for a push event, so a
        // setting Zora changes shows up correctly next time it's opened —
        // no live-update channel needed here.
        lastUndoable.set(win.id, {
          type: "control_center_settings",
          previousValues: { [key]: getControlCenterSettings()[key] } as Partial<ControlCenterSettings>,
        });
        setControlCenterSettings({ [key]: coerced.value } as Partial<ControlCenterSettings>);
        return {
          ok: true,
          text: `Set ${key} to ${JSON.stringify(coerced.value)}.${desc.requiresRelaunch ? " Takes effect after restarting the app." : ""}`,
        };
      }
      case "run_control_center_tool": {
        const action = args.action as ControlCenterActionRequest | undefined;
        if (!action || typeof action.type !== "string") {
          return { ok: false, text: "Missing or invalid action." };
        }
        const result = await runControlCenterAction(ctx, action);
        return { ok: true, text: result === null || result === undefined ? "Done." : truncate(JSON.stringify(result)) };
      }
      case "apply_preset": {
        const name = typeof args.name === "string" ? args.name : "";
        const patch = CONTROL_CENTER_PRESETS[name];
        if (!patch) {
          return { ok: false, text: `Unknown preset "${name}". Available: ${Object.keys(CONTROL_CENTER_PRESETS).join(", ")}.` };
        }
        lastUndoable.set(win.id, {
          type: "control_center_settings",
          previousValues: Object.fromEntries(
            Object.keys(patch).map((k) => [k, getControlCenterSettings()[k as keyof ControlCenterSettings]]),
          ) as Partial<ControlCenterSettings>,
        });
        setControlCenterSettings(patch);
        return { ok: true, text: `Applied preset "${name}": ${Object.entries(patch).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}.` };
      }
      default:
        return { ok: false, text: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[browser-tools] ${name} failed:`, err);
    return { ok: false, text: `Tool ${name} failed to run.` };
  }
}

function resolveId(tabs: TabManager, tabId: unknown): string | null {
  if (typeof tabId === "string" && tabs.getWebContents(tabId)) return tabId;
  return null;
}

function requireId(tabs: TabManager, tabId: unknown): string | null {
  return resolveId(tabs, tabId) ?? tabs.getActiveId();
}

function requireWebContents(tabs: TabManager, tabId: unknown) {
  const id = requireId(tabs, tabId);
  return id ? tabs.getWebContents(id) : null;
}

function notFound(tabId: unknown): ToolResult {
  return { ok: false, text: `No tab with id ${String(tabId)}.` };
}

function noActiveTab(): ToolResult {
  return { ok: false, text: "No active tab." };
}

function truncate(text: string): string {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…(truncated)` : text;
}

type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

// Gemini sends function-call args as loosely-typed JSON — this validates +
// coerces against the field's real type from CONTROL_CENTER_FIELD_DESCRIPTIONS
// before it ever reaches setControlCenterSettings, so a bad value from the
// model becomes a normal "that's not valid" conversational turn instead of
// silently corrupting the settings file.
function coerceControlCenterValue(key: keyof ControlCenterSettings, raw: unknown): CoerceResult {
  const desc = CONTROL_CENTER_FIELD_DESCRIPTIONS[key];
  switch (desc.type) {
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true") return { ok: true, value: true };
      if (raw === "false") return { ok: true, value: false };
      return { ok: false, error: `${key} expects true or false, got ${JSON.stringify(raw)}.` };
    }
    case "number": {
      const num = typeof raw === "number" ? raw : Number(raw);
      if (Number.isNaN(num)) return { ok: false, error: `${key} expects a number, got ${JSON.stringify(raw)}.` };
      return { ok: true, value: num };
    }
    case "enum": {
      if (typeof raw !== "string" || !desc.options?.includes(raw)) {
        return { ok: false, error: `${key} must be one of: ${desc.options?.join(", ")}. Got ${JSON.stringify(raw)}.` };
      }
      return { ok: true, value: raw };
    }
    case "string[]": {
      if (Array.isArray(raw)) return { ok: true, value: raw.map(String) };
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return { ok: true, value: parsed.map(String) };
        } catch {
          // fall through to comma-split below
        }
        return { ok: true, value: raw.split(",").map((s) => s.trim()).filter(Boolean) };
      }
      return { ok: false, error: `${key} expects a list of strings.` };
    }
    case "string":
    default:
      return { ok: true, value: String(raw) };
  }
}

import { shell } from "electron";
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

// Every tool returns a short text result — this is what gets fed back to
// Gemini as the functionResponse content, so keep it compact and factual,
// not chatty. Errors are returned as text too (not thrown) so a bad
// selector/tab id becomes a normal conversational turn ("that tab doesn't
// exist anymore") instead of a hard failure. imageBase64 is see_screen's
// one exception — search-chat/index.ts attaches it as an inlineData part
// alongside the text functionResponse, giving Gemini an actual image, not
// just a description of one.
export type ToolResult = { ok: boolean; text: string; imageBase64?: string };

const MAX_TEXT_CHARS = 6000;
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

export async function executeBrowserTool(
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
        return { ok: true, text: `Closed tab ${id}.` };
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
        // Builds the search URL directly (Google) rather than respecting
        // the person's chosen default search engine (src/lib/settings-store.ts's
        // SEARCH_ENGINES) — that preference is stored in the renderer
        // (localStorage), not reachable from here without a new IPC
        // bridge just for this. A reasonable first pass; worth wiring up
        // properly if it turns out to matter in practice.
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return { ok: false, text: "Missing query." };
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
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
        win.webContents.downloadURL(url);
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

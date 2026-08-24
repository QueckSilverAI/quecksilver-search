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

// Every tool returns a short text result — this is what gets fed back to
// Gemini as the functionResponse content, so keep it compact and factual,
// not chatty. Errors are returned as text too (not thrown) so a bad
// selector/tab id becomes a normal conversational turn ("that tab doesn't
// exist anymore") instead of a hard failure.
export type ToolResult = { ok: boolean; text: string };

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
        tabs.reload(id);
        await tabs.waitForLoad(id);
        return { ok: true, text: "Reloaded." };
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

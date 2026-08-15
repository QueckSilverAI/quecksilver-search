import type { BrowserWindow } from "electron";
import type { TabManager } from "./tab-manager";
import { listBookmarks, saveBookmarks } from "./bookmark-store";
import { HOME_URL } from "./types";

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
]);

export async function executeBrowserTool(
  tabs: TabManager,
  win: BrowserWindow,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
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

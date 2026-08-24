import type { ControlCenterActionRequest } from "./control-center-store";
import { getControlCenterSettings } from "./control-center-store";
import { translatePageInPlace } from "./translate-injector";
import { toggleReaderMode } from "./reader-mode-injector";
// Type-only — see main.ts, WindowEntry is exported there for exactly this
// reuse. Erased at compile time, so this does NOT create a runtime
// circular import between main.ts and this file.
import type { WindowEntry } from "./main";

// Extracted 1:1 out of main.ts's ipcMain.handle("controlCenter:action", ...)
// switch (zora-browser-integration-plan.md, section 7: "Wichtige
// Refaktor-Voraussetzung"). main.ts's IPC handler and Zora's tool
// dispatcher (browser-tools.ts's run_control_center_tool) both call this
// same function now — no double-maintained ~50-case switch.
export async function runControlCenterAction(
  ctx: WindowEntry,
  action: ControlCenterActionRequest,
): Promise<unknown> {
  const tabId = action.tabId ?? ctx.tabs.getActiveId();
  switch (action.type) {
    case "openDevTools":
      if (tabId) ctx.tabs.openDevTools(tabId);
      return null;
    case "reloadNoCache":
      if (tabId) ctx.tabs.reload(tabId, true);
      return null;
    case "clearCache":
      await ctx.tabs.clearCache();
      return null;
    case "screenshot":
      return tabId ? await ctx.tabs.captureScreenshot(tabId) : null;
    case "printPdf":
      return tabId ? await ctx.tabs.saveAsPdf(tabId) : null;
    case "print":
      if (tabId) ctx.tabs.printPage(tabId);
      return null;
    case "savePageAs":
      return tabId ? await ctx.tabs.savePageAs(tabId) : null;
    case "translatePage": {
      const wc = tabId ? ctx.tabs.getWebContents(tabId) : null;
      if (wc) {
        const result = await translatePageInPlace(wc, action.langCode);
        if (!result.ok) console.error("[translatePage] failed:", result.error);
      }
      return null;
    }
    case "unloadTab":
      return tabId ? ctx.tabs.unloadTab(tabId) : false;
    case "unloadAllBackgroundTabs":
      return ctx.tabs.unloadAllBackgroundTabs();
    case "forcePip":
      return tabId ? await ctx.tabs.togglePictureInPicture(tabId) : "no-video";
    case "setNetworkThrottle":
      if (tabId) {
        const cc = getControlCenterSettings();
        await ctx.tabs.setNetworkThrottle(
          tabId,
          action.preset,
          action.preset === "custom"
            ? {
                downloadKbps: cc.customDownloadKbps,
                uploadKbps: cc.customUploadKbps,
                latencyMs: cc.customLatencyMs,
              }
            : undefined,
        );
      }
      return null;
    case "pauseAllMedia":
      await ctx.tabs.pauseAllMedia();
      return null;
    case "muteAllMedia":
      await ctx.tabs.muteAllMedia(action.muted);
      return null;
    case "toggleReaderMode": {
      const wc = tabId ? ctx.tabs.getWebContents(tabId) : null;
      return wc ? await toggleReaderMode(wc) : "error";
    }
    case "setCustomCss":
      await ctx.tabs.setCustomCssForDomain(action.domain, action.css);
      return null;
    case "fullPageScreenshot":
      return tabId ? await ctx.tabs.captureFullPageScreenshot(tabId) : null;
    case "exportPageAsMarkdown":
      return tabId ? await ctx.tabs.exportPageAsMarkdown(tabId) : null;
    case "getPageMetadata":
      return tabId ? await ctx.tabs.getPageMetadata(tabId) : null;
    case "setDeviceEmulation":
      return tabId ? await ctx.tabs.setDeviceEmulation(tabId, action.preset) : false;
    case "startElementPicker":
      return tabId ? await ctx.tabs.startElementPicker(tabId) : false;
    case "getRequestLog":
      return tabId ? ctx.tabs.getRequestLogForTab(tabId) : [];
    case "exportConsoleLog":
      return tabId ? await ctx.tabs.exportConsoleLog(tabId) : null;
    case "getCookiesForTab":
      return tabId ? await ctx.tabs.getCookiesForTab(tabId) : [];
    case "setCookie":
      return tabId ? await ctx.tabs.setCookieForTab(tabId, action.name, action.value) : false;
    case "deleteCookie":
      return tabId ? await ctx.tabs.deleteCookieForTab(tabId, action.name) : false;
    case "getIndexedDbInfo":
      return tabId ? await ctx.tabs.getIndexedDbInfo(tabId) : { databases: [] };
    case "getServiceWorkerStatus":
      return tabId ? await ctx.tabs.getServiceWorkerStatus(tabId) : { registrations: [] };
    case "unregisterServiceWorkers":
      return tabId ? await ctx.tabs.unregisterServiceWorkers(tabId) : 0;
    case "toggleHarRecording":
      return tabId ? await ctx.tabs.toggleHarRecording(tabId) : null;
    case "setRequestMock":
      ctx.tabs.setRequestMockEntry(action.pattern, action.status, action.body);
      return null;
    case "deleteRequestMock":
      ctx.tabs.deleteRequestMockEntry(action.pattern);
      return null;
    case "getRequestMocks":
      return ctx.tabs.getRequestMocks();
    default:
      return null;
  }
}

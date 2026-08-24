import type { WindowEntry } from "./main";
import { getControlCenterSettings, type ControlCenterSettings } from "./control-center-store";
import { getPrivacySettings, type PrivacySettings } from "./privacy-settings-store";
import { getActiveIdentity } from "./profile-store";
import {
  CONTROL_CENTER_FIELD_DESCRIPTIONS,
  type ControlCenterFieldDescription,
} from "./control-center-field-descriptions";
import type { WindowMode } from "./types";

export type AppContextTab = { id: string; title: string; url: string; isActive: boolean };

export type AppContext = {
  controlCenterSettings: ControlCenterSettings;
  controlCenterSchema: Record<string, ControlCenterFieldDescription>;
  privacySettings: PrivacySettings;
  openTabs: AppContextTab[];
  windowMode: WindowMode;
  activeTabDomain: string | null;
};

// zora-browser-integration-plan.md, section 4 — assembled fresh on every
// Zora request instead of baked into a static system prompt, so Zora is
// always in sync with what's actually true right now (which tabs are
// open, what Control Center settings are actually set to).
export function buildAppContext(ctx: WindowEntry): AppContext {
  const { activeId, tabs } = ctx.tabs.listTabs();
  const openTabs: AppContextTab[] = tabs.map((t) => ({
    id: t.id,
    title: t.isHome ? "(new tab)" : t.title,
    url: t.url,
    isActive: t.id === activeId,
  }));

  const activeTab = openTabs.find((t) => t.isActive) ?? null;
  let activeTabDomain: string | null = null;
  if (activeTab?.url) {
    try {
      activeTabDomain = new URL(activeTab.url).hostname || null;
    } catch {
      activeTabDomain = null;
    }
  }

  return {
    controlCenterSettings: getControlCenterSettings(),
    controlCenterSchema: CONTROL_CENTER_FIELD_DESCRIPTIONS,
    privacySettings: getPrivacySettings(),
    openTabs,
    windowMode: getActiveIdentity(ctx.win.id).windowMode ?? "normal",
    activeTabDomain,
  };
}

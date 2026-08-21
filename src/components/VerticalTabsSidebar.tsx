// Left-hand sidebar shown instead of the horizontal tab strip once
// vertical tabs are enabled (see settings-store's useVerticalTabsEnabled,
// toggled from TabsMenuContent). Pushes page content over to the right —
// same idea as Edge's/Claude.ai's own vertical tab lists. Deliberately
// simple: one "New tab" row up top, then every open tab underneath it as
// a plain vertical list (favicon + title, close button on hover). Tab
// GROUPS, drag-reorder, and the folder/context-menu machinery the
// horizontal strip has are intentionally NOT ported here yet — this is
// the base layout, matching what was actually asked for.
import { Plus, X } from "lucide-react";
import type { TabState } from "@/hooks/use-browser-api";
import { TabIcon } from "@/components/TabStrip";

type Props = {
  tabs: TabState[];
  activeId: string | null;
  loadingTabIds: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
};

const SIDEBAR_WIDTH = 240;

export function VerticalTabsSidebar({ tabs, activeId, loadingTabIds, onSelect, onClose, onNewTab }: Props) {
  return (
    <div
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border"
      style={{ width: SIDEBAR_WIDTH, background: "var(--chrome-strip)" }}
    >
      <button
        onClick={onNewTab}
        className="mx-2 mt-2 flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-foreground transition-colors hover:bg-black/[0.06] [-webkit-app-region:no-drag]"
      >
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
        New tab
      </button>

      <div className="mt-1 flex-1 overflow-y-auto px-2 pb-2 [-webkit-app-region:no-drag]">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              title={tab.isHome ? "New Tab" : tab.isSettings ? "Settings" : tab.title || tab.url}
              className={`group mb-0.5 flex h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2.5 text-left transition-colors ${
                active ? "bg-background" : "hover:bg-black/[0.06]"
              }`}
            >
              <TabIcon tab={tab} loading={loadingTabIds.has(tab.id)} useAppLogo={false} />
              <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? "text-foreground" : "text-muted-foreground"}`}>
                {tab.isHome ? "New Tab" : tab.isSettings ? "Settings" : tab.title || tab.url}
              </span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                aria-label="Close tab"
                className="flex shrink-0 rounded p-0.5 opacity-0 hover:bg-foreground/10 group-hover:opacity-100"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

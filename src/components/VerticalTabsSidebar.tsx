// Left-hand sidebar shown instead of the horizontal tab strip once
// vertical tabs are enabled (see settings-store's useVerticalTabsEnabled,
// toggled from TabsMenuContent).
//
// Pinned: renders in-flow (as before), pushing page content over.
// Unpinned ("closed"): renders as a single `fixed` element that is NOT
// part of the flex layout at all — so it takes up zero layout width and
// the toolbar/search bar behind it can reach the true left edge of the
// window. It shows a slim icon-only strip (favicons + a "+" button) by
// default, and widens on hover to the full labelled panel. Using ONE
// element that changes width (rather than a separate rail + a separate
// floating panel) is deliberate: with two siblings, moving the mouse
// from one onto the other used to count as leaving the first, causing
// the sidebar to slam shut the instant the cursor crossed the seam. A
// single element with one set of mouse handlers can't have that bug.
import { useState } from "react";
import { ChevronDown, Pin, Plus, X } from "lucide-react";
import type { TabState } from "@/hooks/use-browser-api";
import { TabIcon } from "@/components/TabStrip";

type Props = {
  tabs: TabState[];
  activeId: string | null;
  loadingTabIds: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  pinned: boolean;
  onTogglePinned: () => void;
  onOpenTabsMenu: (rect: { top: number; left: number; right: number; bottom: number }) => void;
};

const SIDEBAR_WIDTH = 240;
const RAIL_WIDTH = 48; // wide enough to show a row of favicon buttons, not just a hover hairline

export function VerticalTabsSidebar({ tabs, activeId, loadingTabIds, onSelect, onClose, onNewTab, pinned, onTogglePinned, onOpenTabsMenu }: Props) {
  const [hovering, setHovering] = useState(false);
  const expanded = pinned || hovering;

  const tabRow = (tab: TabState, compact: boolean) => {
    const active = tab.id === activeId;
    const label = tab.isHome ? "New Tab" : tab.isSettings ? "Settings" : tab.title || tab.url;
    if (compact) {
      return (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          title={label}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${active ? "bg-background" : "hover:bg-black/[0.06]"}`}
        >
          <TabIcon tab={tab} loading={loadingTabIds.has(tab.id)} useAppLogo={false} />
        </button>
      );
    }
    return (
      <button
        key={tab.id}
        onClick={() => onSelect(tab.id)}
        title={label}
        className={`group mb-0.5 flex h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2.5 text-left transition-colors ${
          active ? "bg-background" : "hover:bg-black/[0.06]"
        }`}
      >
        <TabIcon tab={tab} loading={loadingTabIds.has(tab.id)} useAppLogo={false} />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
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
  };

  const content = expanded ? (
    <>
      {/* Menu (tabs-menu dropdown) + pin button, above the tab list. */}
      <div className="flex h-11 shrink-0 items-center justify-between pl-1 pr-1.5 [-webkit-app-region:drag]">
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onOpenTabsMenu({ top: r.top, left: r.left, right: r.right, bottom: r.bottom });
          }}
          aria-label="Tabs menu"
          className="mx-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-black/[0.05] text-foreground transition-colors hover:bg-black/[0.1] [-webkit-app-region:no-drag]"
        >
          <ChevronDown className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={onTogglePinned}
          aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
          title={pinned ? "Unpin sidebar" : "Pin sidebar"}
          className="mx-1.5 flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-lg text-muted-foreground transition-colors hover:bg-black/[0.06] [-webkit-app-region:no-drag]"
        >
          <Pin className={`h-4 w-4 transition-transform ${pinned ? "text-foreground" : "-rotate-45"}`} />
        </button>
      </div>

      {/* Single scrollable region: tabs, then "New tab" right after the
          last one — not pinned to the sidebar's own bottom edge, so with
          few tabs it sits right under them instead of stranded down in
          empty space. */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 [-webkit-app-region:no-drag]">
        {tabs.map((tab) => tabRow(tab, false))}
        <button
          onClick={onNewTab}
          className="mt-0.5 flex h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-foreground transition-colors hover:bg-black/[0.06] [-webkit-app-region:no-drag]"
        >
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left">New tab</span>
          <span className="text-[11px] text-muted-foreground">Strg+T</span>
        </button>
      </div>
    </>
  ) : (
    // Collapsed strip: favicons only, plus a "+" button — still shows
    // something (not a blank hairline) while closed.
    <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2 [-webkit-app-region:no-drag]">
      {tabs.map((tab) => tabRow(tab, true))}
      <button
        onClick={onNewTab}
        aria-label="New tab"
        title="New tab"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/[0.06] [-webkit-app-region:no-drag]"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );

  if (pinned) {
    return (
      <div className="flex h-full shrink-0 flex-col overflow-hidden" style={{ width: SIDEBAR_WIDTH, background: "var(--chrome-strip)" }}>
        {content}
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="fixed left-0 top-0 z-40 flex h-screen shrink-0 flex-col overflow-hidden shadow-lg transition-[width] duration-150"
      style={{ width: hovering ? SIDEBAR_WIDTH : RAIL_WIDTH, background: "var(--chrome-strip)" }}
    >
      {content}
    </div>
  );
}

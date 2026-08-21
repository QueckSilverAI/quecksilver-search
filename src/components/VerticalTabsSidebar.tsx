// Left-hand sidebar shown instead of the horizontal tab strip once
// vertical tabs are enabled (see settings-store's useVerticalTabsEnabled,
// toggled from TabsMenuContent).
//
// Pinned: renders in-flow (as before), pushing page content over.
// Unpinned ("closed"): renders as a single `absolute` element (positioned
// against the row below the header — see routes/index.tsx) that is NOT
// part of the flex layout at all, so it takes up zero layout width. It
// shows a slim icon-only strip (favicons + a "+" button) by default, and
// widens on hover to the full labelled panel. Using ONE element that
// changes width (rather than a separate rail + a separate floating panel)
// is deliberate: with two siblings, moving the mouse from one onto the
// other used to count as leaving the first, causing the sidebar to slam
// shut the instant the cursor crossed the seam. A single element with one
// set of mouse handlers can't have that bug.
import { useEffect, useRef, useState } from "react";
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
  // Fired whenever the UNPINNED sidebar's own expanded/collapsed state
  // changes (pinned mode never calls this — it doesn't need to, its width
  // is already reserved in layout). The parent uses this to widen the
  // real page's content-view inset while hovering: real browsed pages
  // render in a separate native view that always paints on top of this
  // component's own DOM, so without shrinking that native view's bounds
  // to match, the widened hover panel would just get drawn UNDER
  // whatever site is open — same complaint as "vertical sidebar hidden
  // behind real websites when not pinned".
  onHoverExpandedChange?: (expanded: boolean) => void;
};

export const SIDEBAR_WIDTH = 240;
export const RAIL_WIDTH = 48; // wide enough to show a row of favicon buttons, not just a hover hairline

// How long to wait, after the cursor actually leaves the sidebar, before
// collapsing it. This isn't just debounce polish — the top row (menu
// chevron + pin button) sits in a `-webkit-app-region: drag` strip, and
// frameless-window drag regions are known to fire a spurious mouseleave
// on the element the instant the cursor moves over them, even though the
// cursor never actually left the sidebar's bounds. Without this grace
// period that spurious leave collapsed the panel immediately; a quick
// re-entry (the real mousemove landing a frame later) cancels the pending
// close before it ever fires, so a genuine leave still closes promptly.
const CLOSE_DELAY_MS = 150;

export function VerticalTabsSidebar({
  tabs,
  activeId,
  loadingTabIds,
  onSelect,
  onClose,
  onNewTab,
  pinned,
  onTogglePinned,
  onOpenTabsMenu,
  onHoverExpandedChange,
}: Props) {
  const [hovering, setHovering] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const expanded = pinned || hovering;

  const cancelScheduledClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setHovering(false);
    }, CLOSE_DELAY_MS);
  };
  useEffect(() => cancelScheduledClose, []);
  // Only relevant while unpinned — pinned mode's width is already real
  // layout space, so the content-view inset doesn't need adjusting for it.
  useEffect(() => {
    if (!pinned) onHoverExpandedChange?.(hovering);
  }, [hovering, pinned, onHoverExpandedChange]);
  // If the sidebar goes from unpinned to pinned (or unmounts) while still
  // counted as "hover expanded", make sure the parent's extra inset gets
  // cleared — otherwise it'd stay stuck shrinking the content view for no
  // visible sidebar.
  useEffect(() => {
    if (pinned) onHoverExpandedChange?.(false);
    return () => onHoverExpandedChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned]);

  const tabRow = (tab: TabState, compact: boolean) => {
    const active = tab.id === activeId;
    const label = tab.isHome ? "New Tab" : tab.isSettings ? "Settings" : tab.title || tab.url;
    if (compact) {
      return (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          title={label}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${active ? "bg-black/[0.07]" : "hover:bg-black/[0.06]"}`}
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
        // mb-1.5 (was mb-0.5) — a bit more breathing room between rows,
        // per feedback that the list felt cramped. Active tab now uses a
        // flat black-tint fill (was bg-background) since the sidebar's own
        // background is white now too — "bg-background" would've been
        // invisible against an identically-white sidebar.
        className={`group mb-1.5 flex h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2.5 text-left transition-colors ${
          active ? "bg-black/[0.07]" : "hover:bg-black/[0.06]"
        }`}
      >
        <TabIcon tab={tab} loading={loadingTabIds.has(tab.id)} useAppLogo={false} />
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${active ? "text-foreground" : "text-muted-foreground"}`}
        >
          {label}
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
          // Same bigger-hit-area treatment as the horizontal TabStrip's
          // menu button — 32x32 hover/click target around a smaller
          // visual chip.
          className="mx-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-black/[0.1] [-webkit-app-region:no-drag]"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-black/[0.05]">
            <ChevronDown className="h-[18px] w-[18px]" />
          </span>
        </button>
        <button
          onClick={onTogglePinned}
          aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
          title={pinned ? "Unpin sidebar" : "Pin sidebar"}
          className="mx-1.5 flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-lg text-muted-foreground transition-colors hover:bg-black/[0.06] [-webkit-app-region:no-drag]"
        >
          <Pin
            className={`h-4 w-4 transition-transform ${pinned ? "text-foreground" : "-rotate-45"}`}
          />
        </button>
      </div>

      {/* Single scrollable region: tabs, then "New tab" right after the
          last one — not pinned to the sidebar's own bottom edge, so with
          few tabs it sits right under them instead of stranded down in
          empty space. */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 [-webkit-app-region:no-drag]">
        {tabs.map((tab) => tabRow(tab, false))}
        <div className="mx-2.5 my-1.5 h-px bg-black/10" />
        <button
          onClick={onNewTab}
          className="flex h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-foreground transition-colors hover:bg-black/[0.06] [-webkit-app-region:no-drag]"
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
      <div className="my-1 h-px w-6 shrink-0 bg-black/10" />
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
    // White (var(--background)), matching the page content instead of the
    // grey toolbar chrome — a right-hand border replaces the old
    // grey-vs-white contrast as the visual seam against the content pane.
    return (
      <div
        className="flex h-full shrink-0 flex-col overflow-hidden border-r border-black/10"
        style={{ width: SIDEBAR_WIDTH, background: "var(--background)" }}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => {
        cancelScheduledClose();
        setHovering(true);
      }}
      onMouseLeave={scheduleClose}
      className="absolute left-0 top-0 z-40 flex h-full shrink-0 flex-col overflow-hidden shadow-lg transition-[width] duration-150"
      style={{
        width: hovering ? SIDEBAR_WIDTH : RAIL_WIDTH,
        background: "var(--background)",
        borderRight: hovering ? "1px solid rgba(0,0,0,0.1)" : undefined,
      }}
    >
      {content}
    </div>
  );
}

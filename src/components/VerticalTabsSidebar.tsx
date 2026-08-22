// Left-hand sidebar shown instead of the horizontal tab strip once
// vertical tabs are enabled (see settings-store's useVerticalTabsEnabled,
// toggled from TabsMenuContent).
//
// Always renders in-flow (pushing page content over), at one of two
// widths: RAIL_WIDTH (collapsed — favicons only) or SIDEBAR_WIDTH
// (expanded — full labelled panel). Which width is showing is driven
// purely by the `open` prop, toggled by clicking the sidebar button —
// NOT by hovering. There used to be a separate "unpinned" mode that
// rendered as an absolute overlay and expanded on hover, but that meant
// widening the panel had to also shrink/move the real browsed page's
// native view to keep it from covering the panel (that view always
// paints above this component's own DOM regardless of z-index) — so
// just brushing the mouse across the rail was enough to shift whatever
// site was open. Collapsing that into a single always-in-flow width,
// toggled only by a deliberate click, means the page only ever moves
// when the person actually asked it to.
import { PanelLeft, Plus, SlidersHorizontal, X } from "lucide-react";
import type { TabState } from "@/hooks/use-browser-api";
import { TabIcon } from "@/components/TabStrip";

type Props = {
  tabs: TabState[];
  activeId: string | null;
  loadingTabIds: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  open: boolean;
  onToggleOpen: () => void;
  onOpenTabsMenu: (rect: { top: number; left: number; right: number; bottom: number }) => void;
  // Whether the content column's header favorites bar is currently showing
  // (same condition the caller uses to render it) — drives the height of
  // the divider below, so it lines up with, and never runs past, that bar.
  showFavoritesDivider: boolean;
};

export const SIDEBAR_WIDTH = 240;
export const RAIL_WIDTH = 48; // wide enough to show a row of favicon buttons, not just a hairline

// Height of the header favorites bar's own row (HeaderFavoritesBar's
// h-[29px] chips + the wrapper's pb-1.5, in routes/index.tsx). Kept in
// sync by hand rather than measured, since it's a plain fixed-height row
// on both sides — used below to size both the top divider and this
// sidebar's own header row so they line up with it exactly.
const TOP_ROW_HEIGHT = 35;

export function VerticalTabsSidebar({
  tabs,
  activeId,
  loadingTabIds,
  onSelect,
  onClose,
  onNewTab,
  open,
  onToggleOpen,
  onOpenTabsMenu,
  showFavoritesDivider,
}: Props) {
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

  const content = open ? (
    <>
      {/* Menu (tabs-menu dropdown) + sidebar-toggle button, above the tab
          list. Row height/padding (not a fixed h-11) matches
          TOP_ROW_HEIGHT — same total height as the favorites bar's own
          row in the content column next to it — so "Collapse sidebar"
          sits at the same height as the favorites row rather than the
          taller h-11 toolbar band above it.
          Both buttons use explicit inline width/height/padding:0 rather
          than Tailwind size classes — a plain <button>'s browser-default
          padding/border isn't guaranteed even on all four sides, and that
          was enough to throw off how square these looked. Inline values
          leave nothing for the UA stylesheet to add on top of. */}
      <div className="flex shrink-0 items-center justify-between px-1.5 pb-1.5 pt-0 [-webkit-app-region:drag]">
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onOpenTabsMenu({ top: r.top, left: r.left, right: r.right, bottom: r.bottom });
          }}
          aria-label="Kontrollzentrum"
          style={{ height: 29, width: 29, aspectRatio: "1 / 1", padding: 0, border: 0, boxSizing: "border-box" }}
          className="flex items-center justify-center rounded-lg bg-black/[0.05] text-foreground transition-colors hover:bg-black/[0.1] [-webkit-app-region:no-drag]"
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0" />
        </button>
        {/* Plain two-panel icon, same either state — no arrow/chevron
            drawn inside it (unlike PanelLeftClose/PanelLeftOpen) — just a
            tint change to hint at "on". */}
        <button
          onClick={onToggleOpen}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          style={{ height: 29, width: 29, padding: 0, border: 0 }}
          className="flex items-center justify-center rounded-lg bg-black/[0.05] text-foreground transition-colors hover:bg-black/[0.1] [-webkit-app-region:no-drag]"
        >
          <PanelLeft className="h-4 w-4" />
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
    // Collapsed strip: the toggle button up top (so it's always
    // reachable, whatever state the sidebar is in), then favicons, then
    // a "+" button. pt-0 on this wrapper (not the same py-2 the rest of
    // the column uses) deliberately matches the open state's row above
    // (px-1.5 pb-1.5 pt-0) — both start the toggle button at the exact
    // same y=0 offset from the sidebar's top edge. Before this, this
    // wrapper used a plain py-2 (8px top padding), which pushed the
    // button 8px lower than in the open state — visible as the Control
    // center/toggle buttons "jumping down" the moment the sidebar
    // collapsed. pb-2 alone keeps the same breathing room above the
    // favicon list below it.
    <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto pt-0 pb-2 [-webkit-app-region:no-drag]">
      <button
        onClick={onToggleOpen}
        aria-label="Expand sidebar"
        title="Expand sidebar"
        style={{ height: 29, width: 29, padding: 0, border: 0 }}
        className="mb-1 flex shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/[0.06]"
      >
        <PanelLeft className="h-4 w-4" />
      </button>
      {tabs.map((tab) => tabRow(tab, true))}
      <div className="my-1 h-px w-6 shrink-0 bg-black/10" />
      <button
        onClick={onNewTab}
        aria-label="New tab"
        title="New tab"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/[0.06]"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );

  // White (var(--background)), matching the page content instead of the
  // grey toolbar chrome. The divider between this and the content next to
  // it is NOT a plain full-height border — it deliberately skips the top
  // TOP_ROW_HEIGHT band (where the favorites bar sits, when it's shown)
  // and only runs from there down to the bottom, alongside the actual
  // page content. Previously this was backwards (only the top band had a
  // line, nothing below it) — now it's inverted: no line next to
  // favorites, a line everywhere else down the sidebar. When there's no
  // favorites bar to skip past, it just runs the full height instead.
  return (
    <div
      className="relative flex h-full shrink-0 flex-col overflow-hidden transition-[width] duration-150"
      style={{ width: open ? SIDEBAR_WIDTH : RAIL_WIDTH, background: "var(--background)" }}
    >
      <div
        className="pointer-events-none absolute right-0 bottom-0 w-px bg-black/10"
        style={{ top: showFavoritesDivider ? TOP_ROW_HEIGHT : 0 }}
      />
      {content}
    </div>
  );
}

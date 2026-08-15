import { useLayoutEffect, useReducer, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FolderInput, FolderMinus, FolderPlus, Loader2, Plus, Search as SearchIcon, Settings as SettingsIcon, Trash2, Volume2, VolumeX, X } from "lucide-react";
import type { TabGroup, TabState } from "@/hooks/use-browser-api";
import { QueckSilverLogo } from "@/components/QueckSilverLogo";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";

type Props = {
  tabs: TabState[];
  groups: TabGroup[];
  activeId: string | null;
  loadingTabIds: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onToggleMute: (id: string) => void;
  onReorder: (newOrder: string[]) => void;
  onNewTab: () => void;
  onLogoClick: () => void;
  onToggleGroupCollapse: (groupId: string) => void;
  onCreateGroup: (tabId: string) => void;
  onAddToGroup: (tabId: string, groupId: string) => void;
  onRemoveFromGroup: (tabId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onUngroup: (groupId: string) => void;
  hasNativeControls: boolean;
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onCloseWindow: () => void;
};

function faviconUrl(pageUrl: string): string | null {
  try {
    const host = new URL(pageUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}

// `useAppLogo` is true once a tab is so narrow there's no meaningful room to
// tell favicons apart anyway — at that point we show the plain app mark
// instead of fetching/rendering a per-tab favicon.
function TabIcon({ tab, loading, useAppLogo }: { tab: TabState; loading: boolean; useAppLogo: boolean }) {
  const [failed, setFailed] = useState(false);
  if (loading || tab.isLoading) {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--brand)" }} />;
  }
  if (tab.isSettings) {
    return <SettingsIcon className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
  if (tab.isHome) {
    return <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
  if (useAppLogo) {
    return <QueckSilverLogo className="h-4 w-4 shrink-0" style={{ color: "var(--brand)" }} />;
  }
  const src = !failed ? faviconUrl(tab.url) : null;
  if (!src) return <span className="h-4 w-4 shrink-0" />;
  return <img src={src} alt="" draggable={false} onError={() => setFailed(true)} className="h-4 w-4 shrink-0 rounded-sm" />;
}

// The active tab's little rounded "cutout" corners that visually merge it
// into the toolbar below — same trick as the reference design (two small
// absolutely-positioned circles carved out of the tab's own background via
// radial-gradient). Uses var(--background) directly — it's already a full
// oklch(...) color function, wrapping it in hsl() (as a previous pass did)
// produces invalid CSS that silently breaks the whole cutout. 10px to match
// the window's own corner radius elsewhere.
const NOTCH = 10;
function TabNotch({ side }: { side: "left" | "right" }) {
  return (
    <div
      className="pointer-events-none absolute bottom-0"
      style={{
        [side]: `-${NOTCH}px`,
        height: NOTCH,
        width: NOTCH,
        background: `radial-gradient(circle at top left, transparent ${NOTCH}px, var(--background) ${NOTCH}px)`,
        transform: side === "right" ? "scaleX(-1)" : undefined,
      } as React.CSSProperties}
    />
  );
}

// Tabs shrink to fit as more of them open — same idea as Chrome/Edge: each
// tab gets an equal share of the space left over after the "+" button,
// clamped between a floor and a ceiling. Below certain widths there just
// isn't room for a title or a close button anymore, so those drop away in
// stages, ending with a bare icon at the floor width.
const MAX_TAB_WIDTH = 200;
const MIN_TAB_WIDTH = 40;
const TEXT_HIDE_WIDTH = 96; // below this, no room left for a readable title
const CLOSE_HIDE_WIDTH = 64; // below this, the close button only appears on hover
const LOGO_SWITCH_WIDTH = 52; // below this, favicons give way to the plain app mark
const NEW_TAB_BTN_SPACE = 32; // reserved out of the container so the "+" button
// (which lives inside the same flex row, not clamped/shrunk like tabs) always
// has room without stealing from the tabWidth math.
const TAB_HEIGHT = "h-10"; // same for active and inactive — only the white
// background + notch corners signal "active", not a height change, so
// switching tabs never looks like anything is growing/shrinking.

export function TabStrip({
  tabs,
  groups,
  activeId,
  loadingTabIds,
  onSelect,
  onClose,
  onToggleMute,
  onReorder,
  onNewTab,
  onLogoClick,
  onToggleGroupCollapse,
  onCreateGroup,
  onAddToGroup,
  onRemoveFromGroup,
  onDeleteGroup,
  onUngroup,
  hasNativeControls,
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onCloseWindow,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const groupsById = new Map(groups.map((g) => [g.id, g]));

  // --- Live drag-reorder -------------------------------------------------
  // Deliberately NOT native HTML5 drag-and-drop (that leaves the original
  // tab sitting in place, half-transparent, while a disconnected ghost
  // image follows the cursor). Instead the grabbed tab itself tracks the
  // pointer via a CSS transform, and the other tabs slide out of the way
  // live as it crosses their midpoint — same feel as Chrome/Edge's own tab
  // strip. Order is kept in a ref (not state) so pointermove — which can
  // fire dozens of times a second — never waits on a React re-render to
  // read the latest value; a version counter forces the re-renders that
  // are actually needed (when the order itself changes).
  const orderRef = useRef<string[]>(tabs.map((t) => t.id));
  const [version, bumpVersion] = useReducer((c: number) => c + 1, 0);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  const dragInfo = useRef<{ id: string; startX: number; originIndex: number; shift: number; slotWidth: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Keep orderRef in sync with the authoritative tabs prop (new/closed
  // tabs, or a reorder confirmed from the main process) whenever nothing
  // is actively being dragged right now.
  if (!dragInfo.current) {
    const propIds = tabs.map((t) => t.id);
    const sameSet = orderRef.current.length === propIds.length && orderRef.current.every((id) => propIds.includes(id));
    if (!sameSet) orderRef.current = propIds;
  }

  const tabsById = new Map(tabs.map((t) => [t.id, t]));
  const orderedTabs = orderRef.current.map((id) => tabsById.get(id)).filter((t): t is TabState => Boolean(t));

  function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
  }

  // --- Shrink-to-fit tab width --------------------------------------------
  // The row that holds the tabs (+ the "+" button) reports its own width
  // here — it's flex-1, so it always spans exactly the space left over
  // after the logo and the window controls. The actual per-tab box width is
  // handled by flexbox itself (flex-grow/shrink with a min/max clamp) so it
  // always sums exactly to the available space with no leftover fractional
  // pixel — that fractional drift was what made the last tab's corner lose
  // its rounding (the container would clip a sliver of it). This computed
  // `tabWidth` is only an estimate used to decide when to hide text/close
  // button/favicons; it doesn't set anything's actual pixel width.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tabCount = Math.max(orderedTabs.length, 1);
  const availableForTabs = Math.max(containerWidth - NEW_TAB_BTN_SPACE, 0);
  const tabWidth = containerWidth > 0 ? clamp(availableForTabs / tabCount, MIN_TAB_WIDTH, MAX_TAB_WIDTH) : MAX_TAB_WIDTH;
  const showText = tabWidth >= TEXT_HIDE_WIDTH;
  const showCloseAlways = tabWidth >= CLOSE_HIDE_WIDTH;
  const useAppLogo = tabWidth <= LOGO_SWITCH_WIDTH;

  // FLIP animation: whenever the visual order actually changes (a splice
  // during drag, tracked by `version`), the tabs that got displaced jump
  // straight to their new flex slot — this measures where each one WAS
  // right before that jump and animates from there back to 0, so the jump
  // reads as a smooth slide. The tab actually being dragged is excluded —
  // its position is driven directly by the pointer, not by this animation.
  // Gated on `version` specifically, not "every render": tabs re-render for
  // lots of unrelated reasons (title/loading updates streaming in, hover
  // state, window resizes changing tabWidth) and none of those are a splice
  // — running this logic for them read rects mid-transition and fought with
  // itself, which is what made the tabs twitch even at rest.
  useLayoutEffect(() => {
    for (const tab of orderedTabs) {
      if (tab.id === draggingId) continue;
      const el = tabRefs.current.get(tab.id);
      if (!el) continue;
      const prev = prevRects.current.get(tab.id);
      const curr = el.getBoundingClientRect();
      if (prev && Math.abs(prev.left - curr.left) > 0.5) {
        const dx = prev.left - curr.left;
        el.style.transition = "none";
        el.style.transform = `translateX(${dx}px)`;
        el.getBoundingClientRect(); // force reflow before re-enabling the transition
        requestAnimationFrame(() => {
          el.style.transition = "transform 160ms ease";
          el.style.transform = "";
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Keeps the FLIP baseline current after every render (cheap — just reads,
  // no style writes) so the effect above always compares against the real
  // "before" position next time the order changes, even across renders
  // that weren't reorders (e.g. the tab strip resizing).
  useLayoutEffect(() => {
    for (const tab of orderedTabs) {
      const el = tabRefs.current.get(tab.id);
      if (el) prevRects.current.set(tab.id, el.getBoundingClientRect());
    }
  });

  function beginDrag(tabId: string, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const el = tabRefs.current.get(tabId);
    if (!el) return;
    // A tab has to be the active one to be draggable in any meaningful way
    // (it's the one the pointer math treats as "here"), so grabbing a
    // background tab selects it immediately, same moment the drag starts.
    if (tabId !== activeId) onSelect(tabId);
    // No preventDefault() here — on a mouse pointer that would suppress the
    // compatibility click event per the Pointer Events spec, which is what
    // onClick below relies on to select the tab on a plain (non-drag) click.
    el.setPointerCapture(e.pointerId);
    dragInfo.current = {
      id: tabId,
      startX: e.clientX,
      originIndex: orderRef.current.indexOf(tabId),
      shift: 0,
      // Measured live rather than reusing the render's `tabWidth` estimate:
      // actual per-tab width is whatever flexbox settled on, which can
      // differ slightly from the JS estimate right at the min/max clamp —
      // using the real box keeps the drag transform pixel-accurate.
      slotWidth: el.getBoundingClientRect().width,
    };
    setDraggingId(tabId);
    el.style.transition = "none";
    el.style.zIndex = "30";
    el.style.position = "relative";
    el.style.boxShadow = "0 4px 14px rgba(0,0,0,0.18)";
  }

  function onDragMove(tabId: string, e: React.PointerEvent<HTMLDivElement>) {
    const info = dragInfo.current;
    if (!info || info.id !== tabId) return;
    const totalDx = e.clientX - info.startX;
    const rawShift = totalDx / info.slotWidth;
    // Hysteresis around each slot boundary: the raw threshold sits exactly
    // at ±0.5 tab-widths, so a pointer holding still right there (or jittery
    // input near it) flips the order back and forth every tiny move — that's
    // the "twitching" tabs. Only commit to a new slot once the pointer has
    // travelled a bit past the boundary in that direction; moving back
    // requires crossing the same margin the other way, so there's a dead
    // zone instead of a hard line.
    const HYSTERESIS = 0.15;
    let shift = info.shift;
    if (rawShift - shift > 0.5 + HYSTERESIS) {
      shift = Math.round(rawShift - HYSTERESIS);
    } else if (shift - rawShift > 0.5 + HYSTERESIS) {
      shift = Math.round(rawShift + HYSTERESIS);
    }
    info.shift = shift;
    const newIndex = clamp(info.originIndex + shift, 0, orderRef.current.length - 1);
    const currentIndex = orderRef.current.indexOf(tabId);
    if (newIndex !== currentIndex) {
      const next = orderRef.current.filter((id) => id !== tabId);
      next.splice(newIndex, 0, tabId);
      orderRef.current = next;
      bumpVersion();
    }
    // The tab's DOM slot already absorbed indexDelta * slotWidth of the
    // pointer's travel via the reorder above — only the remainder needs to
    // be made up with a transform, so the tab always sits exactly under
    // the cursor regardless of how many times it's been re-slotted.
    const indexDelta = newIndex - info.originIndex;
    const remaining = totalDx - indexDelta * info.slotWidth;
    const el = tabRefs.current.get(tabId);
    if (el) el.style.transform = `translateX(${remaining}px)`;
  }

  function endDrag(tabId: string, e: React.PointerEvent<HTMLDivElement>) {
    const info = dragInfo.current;
    if (!info || info.id !== tabId) return;
    const el = tabRefs.current.get(tabId);
    if (el) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // already released — fine
      }
      el.style.transition = "transform 120ms ease";
      el.style.transform = "";
      el.style.zIndex = "";
      el.style.position = "";
      el.style.boxShadow = "";
    }
    dragInfo.current = null;
    setDraggingId(null);
    const propOrder = tabs.map((t) => t.id);
    const changed = orderRef.current.length !== propOrder.length || orderRef.current.some((id, i) => id !== propOrder[i]);
    if (changed) onReorder([...orderRef.current]);
  }

  return (
    <div className="relative flex h-12 shrink-0 items-center gap-0 rounded-t-[10px] pl-2.5 pr-3 [-webkit-app-region:drag]" style={{ background: "var(--chrome-strip)" }}>
      <button
        onClick={onLogoClick}
        aria-label="QueckSilver, quecksilver.ch"
        className="group relative flex h-7 w-7 shrink-0 items-center justify-center self-center [-webkit-app-region:no-drag]"
      >
        <span className="pointer-events-none absolute -inset-1 rounded-lg transition-colors group-hover:bg-black/[0.06]" />
        <QueckSilverLogo className="relative h-5 w-auto" style={{ color: "var(--brand)" }} />
      </button>

      {/* flex-1 so this row always claims exactly the space left over after
          the logo and window-control buttons — that measured width feeds
          the shrink-to-fit tab math above. The "+" button lives INSIDE this
          row, right after the last tab (not as a separate sibling out at
          the row's far edge) — that's what makes it follow the tabs when
          some get closed, instead of stranding out on the right with a gap
          behind it. The container itself carries the drag region (so any
          leftover space past the "+" button still drags the window); each
          tab and the button opt back out of that individually. pl-2.5/
          pr-2.5 leave room for the active tab's left/right notches —
          without them, a notch's -10px offset gets clipped by this
          container's own scroll edge whenever that tab is first (left) or
          last (right) in the list. overflow-x-auto is a fallback only: tabs
          shrink down to MIN_TAB_WIDTH to fit, so it should essentially
          never trigger, but it's there in case an extreme tab count still
          doesn't fit. Divider visibility is driven by React state
          (hoveredId), not a CSS sibling trick — that only ever hid one side
          reliably. */}
      <div ref={containerRef} className="flex min-w-0 flex-1 items-end gap-0 self-end overflow-x-auto pl-2.5 pr-2.5 [-webkit-app-region:drag]">
        {(() => {
          const seenCollapsedGroups = new Set<string>();
          return orderedTabs.map((tab, i) => {
            const group = tab.groupId ? groupsById.get(tab.groupId) : undefined;
            if (group?.collapsed) {
              if (seenCollapsedGroups.has(group.id)) return null;
              seenCollapsedGroups.add(group.id);
              const memberCount = orderedTabs.filter((t) => t.groupId === group.id).length;
              // While collapsed, the group tab stands in for whichever
              // member tab is actually active — same white/notched look a
              // real active tab gets, since as far as the person can see
              // right now, THIS is the selected tab.
              const groupIsActive = orderedTabs.some((t) => t.groupId === group.id && t.id === activeId);
              return (
                <ContextMenu key={`group-${group.id}`}>
                  <ContextMenuTrigger asChild>
                    <div
                      onClick={() => onToggleGroupCollapse(group.id)}
                      // Real tab classes (active or inactive, matching
                      // groupIsActive) — just shrink-0 instead of the
                      // flexGrow/minWidth/maxWidth a real tab slot uses, so
                      // it sizes to its own content (name + count) rather
                      // than stretching to fill a full tab's share of the
                      // strip. One deliberate departure from a real
                      // inactive tab: those have NO background at all by
                      // default (only on hover) and get away with it
                      // because neighboring tabs/dividers already show
                      // where they are — this sits alone next to the
                      // strip, so with the same fully-transparent default
                      // its rounded-tab shape was invisible and all that
                      // showed was the inner colored name badge, looking
                      // like a bare pill instead of a tab. A faint
                      // permanent tint keeps the tab silhouette visible at
                      // all times.
                      className={
                        groupIsActive
                          ? `relative mx-0.5 flex ${TAB_HEIGHT} shrink-0 cursor-pointer select-none items-center gap-1.5 self-end rounded-t-[10px] bg-background px-2.5 [-webkit-app-region:no-drag]`
                          : `mx-0.5 flex ${TAB_HEIGHT} shrink-0 cursor-pointer select-none items-center gap-1.5 self-end rounded-t-lg bg-foreground/[0.06] px-2.5 text-muted-foreground transition-colors hover:bg-foreground/10 [-webkit-app-region:no-drag]`
                      }
                      title={group.name}
                    >
                      {groupIsActive && (
                        <>
                          <TabNotch side="left" />
                          <TabNotch side="right" />
                        </>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      {showText ? (
                        // The color wraps tightly around the name itself —
                        // a small badge inside the tab — not the whole
                        // tab, which otherwise looks exactly like a real
                        // one (see className above).
                        <span
                          className="max-w-[100px] truncate rounded-full px-2 py-0.5 text-[12px] font-semibold text-white"
                          style={{ background: group.color }}
                        >
                          {group.name}
                        </span>
                      ) : (
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: group.color }} />
                      )}
                      {showText && <span className="shrink-0 text-[12px] text-muted-foreground">{memberCount}</span>}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => onToggleGroupCollapse(group.id)}>
                      <ChevronRight className="mr-2 h-3.5 w-3.5" />
                      Expand group
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onUngroup(group.id)}>
                      <FolderMinus className="mr-2 h-3.5 w-3.5" />
                      Ungroup
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-destructive" onClick={() => onDeleteGroup(group.id)}>
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete group (closes {memberCount} tab{memberCount === 1 ? "" : "s"})
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            }

            const active = tab.id === activeId;
            const prevActive = i > 0 && orderedTabs[i - 1]?.id === activeId;
            const prevId = i > 0 ? orderedTabs[i - 1]?.id : undefined;
            const dividerHidden = hoveredId !== null && (hoveredId === tab.id || hoveredId === prevId);
            const showClose = showCloseAlways || hoveredId === tab.id || active;
            // A group has no separate header row — its name lives on a
            // small solid-color capsule right before the first tab of a
            // contiguous same-group run; every tab in that run gets a
            // light tint of the group's color so the whole run reads as
            // one cluster (closest approximation to Chrome's grouped-tabs
            // look without needing a real wrapping box around a set of
            // flex siblings).
            const isFirstOfGroupRun = Boolean(group) && orderedTabs[i - 1]?.groupId !== group?.id;
            return (
              <div key={tab.id} className="contents">
                {/* Divider between adjacent inactive tabs only — Edge hides it
                    right next to the active tab, which already has its own
                    visual separation via the notch corners. */}
                {i > 0 && !active && !prevActive && (
                  <div
                    className="mb-2 h-6 w-px shrink-0 self-end bg-black/10 transition-opacity"
                    style={{ opacity: dividerHidden || draggingId !== null ? 0 : 1 }}
                  />
                )}
                {group && isFirstOfGroupRun && (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleGroupCollapse(group.id);
                        }}
                        // Always the inactive look, even while a member
                        // tab right next to it IS active — once expanded,
                        // that active tab shows itself, this header isn't
                        // standing in for anything anymore.
                        className={`mx-0.5 flex ${TAB_HEIGHT} shrink-0 cursor-pointer select-none items-center gap-1.5 self-end rounded-t-lg bg-foreground/[0.06] px-2.5 text-muted-foreground transition-colors hover:bg-foreground/10 [-webkit-app-region:no-drag]`}
                        title={group.name}
                      >
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        {showText ? (
                          <span
                            className="max-w-[100px] truncate rounded-full px-2 py-0.5 text-[12px] font-semibold text-white"
                            style={{ background: group.color }}
                          >
                            {group.name}
                          </span>
                        ) : (
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: group.color }} />
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => onToggleGroupCollapse(group.id)}>
                        <ChevronDown className="mr-2 h-3.5 w-3.5" />
                        Collapse group
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => onUngroup(group.id)}>
                        <FolderMinus className="mr-2 h-3.5 w-3.5" />
                        Ungroup
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem className="text-destructive" onClick={() => onDeleteGroup(group.id)}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Delete group
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )}
                <ContextMenu key={`ctx-${tab.id}`}>
                  <ContextMenuTrigger asChild>
                    <div
                      ref={(el) => {
                        if (el) tabRefs.current.set(tab.id, el);
                        else tabRefs.current.delete(tab.id);
                      }}
                      onPointerDown={(e) => beginDrag(tab.id, e)}
                      onPointerMove={(e) => onDragMove(tab.id, e)}
                      onPointerUp={(e) => endDrag(tab.id, e)}
                      onPointerCancel={(e) => endDrag(tab.id, e)}
                      onClick={() => onSelect(tab.id)}
                      onMouseEnter={() => setHoveredId(tab.id)}
                      onMouseLeave={() => setHoveredId((v) => (v === tab.id ? null : v))}
                      className={
                        active
                          ? `relative flex ${TAB_HEIGHT} shrink cursor-pointer select-none items-center self-end rounded-t-[10px] bg-background [-webkit-app-region:no-drag]`
                          : `relative flex ${TAB_HEIGHT} shrink cursor-pointer select-none items-center self-end rounded-t-lg text-muted-foreground transition-colors hover:bg-foreground/5 [-webkit-app-region:no-drag]`
                      }
                      style={{
                        flexGrow: 1,
                        flexBasis: 0,
                        minWidth: MIN_TAB_WIDTH,
                        maxWidth: MAX_TAB_WIDTH,
                        touchAction: "none",
                        WebkitUserDrag: "none",
                        gap: showText ? 8 : showClose ? 4 : 0,
                        paddingLeft: showText ? 10 : 0,
                        paddingRight: showText ? 10 : 0,
                        justifyContent: showText ? undefined : "center",
                        // Light tint of the group's color on top of the
                        // underline strip below — together with the label
                        // capsule above, this is what reads as "these tabs
                        // belong together". The active tab keeps its plain
                        // white background (its notch corners are already
                        // the "this one's selected" signal).
                        background: group && !active ? `${group.color}1f` : undefined,
                      } as React.CSSProperties}
                    >
                      {group && (
                        // A real element, not a box-shadow — this used to
                        // be an inset box-shadow on the tab itself, which
                        // in at least some state (never fully pinned down,
                        // but consistently reported as "goes away") wasn't
                        // reliably staying visible. An explicit
                        // bottom-edge strip has nothing else that can
                        // suppress it.
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] rounded-b-[1px]" style={{ background: group.color }} />
                      )}
                      {active && (
                        <>
                          <TabNotch side="left" />
                          <TabNotch side="right" />
                        </>
                      )}
                      <TabIcon tab={tab} loading={loadingTabIds.has(tab.id)} useAppLogo={useAppLogo} />
                      {showText && (
                        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                          {tab.isHome ? "New Tab" : tab.isSettings ? "Settings" : tab.title || tab.url}
                        </span>
                      )}
                      {(tab.isAudible || tab.isMuted) && (
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleMute(tab.id);
                          }}
                          aria-label={tab.isMuted ? "Unmute tab" : "Mute tab"}
                          title={tab.isMuted ? "Unmute tab" : "Mute tab"}
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                        >
                          {tab.isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {showClose && (
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onClose(tab.id);
                          }}
                          aria-label="Close tab"
                          className="shrink-0 rounded p-0.5 hover:bg-foreground/10"
                        >
                          <X className="h-3 w-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    {group ? (
                      <>
                        <ContextMenuItem onClick={() => onRemoveFromGroup(tab.id)}>
                          <FolderMinus className="mr-2 h-3.5 w-3.5" />
                          Remove from group
                        </ContextMenuItem>
                        <ContextMenuItem className="text-destructive" onClick={() => onDeleteGroup(group.id)}>
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete group
                        </ContextMenuItem>
                      </>
                    ) : (
                      <ContextMenuItem onClick={() => onCreateGroup(tab.id)}>
                        <FolderPlus className="mr-2 h-3.5 w-3.5" />
                        New group
                      </ContextMenuItem>
                    )}
                    {groups.length > 0 && (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <FolderInput className="mr-2 h-3.5 w-3.5" />
                          Add to group
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {groups.map((g) => (
                            <ContextMenuItem key={g.id} disabled={g.id === group?.id} onClick={() => onAddToGroup(tab.id, g.id)}>
                              <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: g.color }} />
                              {g.name}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => onClose(tab.id)}>
                      <X className="mr-2 h-3.5 w-3.5" />
                      Close tab
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            );
          });
        })()}

        {/* Same trailing divider as between two adjacent inactive tabs —
            without it the last tab ran straight into the "+" button with
            no separation at all, while every other inactive/inactive
            boundary got one. Skipped when the last slot IS the active tab
            (that already has its own notch-corner separation, same rule
            as the between-tab dividers above) or when hovering that tab. */}
        {(() => {
          const lastTab = orderedTabs[orderedTabs.length - 1];
          if (!lastTab) return null;
          const lastGroup = lastTab.groupId ? groupsById.get(lastTab.groupId) : undefined;
          const lastIsCollapsedGroup = Boolean(lastGroup?.collapsed);
          const lastSlotActive = lastIsCollapsedGroup
            ? orderedTabs.some((t) => t.groupId === lastGroup!.id && t.id === activeId)
            : lastTab.id === activeId;
          const lastDividerHidden = !lastIsCollapsedGroup && hoveredId === lastTab.id;
          if (lastSlotActive) return null;
          return (
            <div
              className="mb-2 h-6 w-px shrink-0 self-end bg-black/10 transition-opacity"
              style={{ opacity: lastDividerHidden || draggingId !== null ? 0 : 1 }}
            />
          );
        })()}

        <button
          onClick={onNewTab}
          aria-label="New tab"
          className="ml-1.5 mb-1.5 flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-lg text-black transition-colors hover:bg-black/10 [-webkit-app-region:no-drag]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {!hasNativeControls && (
        <div className="-mr-3 flex h-full shrink-0 items-stretch [-webkit-app-region:no-drag]">
          <button
            onClick={onMinimize}
            aria-label="Minimize"
            className="flex w-[46px] items-center justify-center text-black transition-colors hover:bg-black/[0.06]"
          >
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
          </button>
          <button
            onClick={onToggleMaximize}
            aria-label={isMaximized ? "Restore" : "Maximize"}
            className="flex w-[46px] items-center justify-center text-black transition-colors hover:bg-black/[0.06]"
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
                <path d="M2.5 2.5V0.5H9.5V7.5H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button
            onClick={onCloseWindow}
            aria-label="Close window"
            className="flex w-[46px] items-center justify-center rounded-tr-[10px] text-black transition-colors hover:bg-[#c42b1c] hover:text-white"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
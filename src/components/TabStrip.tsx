import { useLayoutEffect, useReducer, useRef, useState } from "react";
import { Loader2, Plus, Search as SearchIcon, Settings as SettingsIcon, X } from "lucide-react";
import type { TabState } from "@/hooks/use-browser-api";
import { QueckSilverLogo } from "@/components/QueckSilverLogo";

type Props = {
  tabs: TabState[];
  activeId: string | null;
  loadingTabIds: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (newOrder: string[]) => void;
  onNewTab: () => void;
  onLogoClick: () => void;
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

function TabIcon({ tab, loading }: { tab: TabState; loading: boolean }) {
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

const TAB_WIDTH = 200; // fixed — tabs never resize as siblings open/close
const TAB_HEIGHT = "h-10"; // same for active and inactive — only the white
// background + notch corners signal "active", not a height change, so
// switching tabs never looks like anything is growing/shrinking.

export function TabStrip({
  tabs,
  activeId,
  loadingTabIds,
  onSelect,
  onClose,
  onReorder,
  onNewTab,
  onLogoClick,
  hasNativeControls,
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onCloseWindow,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
  const [, bumpVersion] = useReducer((c: number) => c + 1, 0);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  const dragInfo = useRef<{ id: string; startX: number; originIndex: number } | null>(null);
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

  // FLIP animation: whenever the visual order changes (a splice during
  // drag), the tabs that got displaced jump straight to their new flex
  // slot — this measures where each one WAS right before that jump and
  // animates from there back to 0, so the jump reads as a smooth slide.
  // The tab actually being dragged is excluded — its position is driven
  // directly by the pointer, not by this animation.
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
    for (const tab of orderedTabs) {
      const el = tabRefs.current.get(tab.id);
      if (el) prevRects.current.set(tab.id, el.getBoundingClientRect());
    }
  });

  function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
  }

  function beginDrag(tabId: string, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const el = tabRefs.current.get(tabId);
    if (!el) return;
    // No preventDefault() here — on a mouse pointer that would suppress the
    // compatibility click event per the Pointer Events spec, which is what
    // onClick below relies on to select the tab on a plain (non-drag) click.
    el.setPointerCapture(e.pointerId);
    dragInfo.current = { id: tabId, startX: e.clientX, originIndex: orderRef.current.indexOf(tabId) };
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
    const shift = Math.round(totalDx / TAB_WIDTH);
    const newIndex = clamp(info.originIndex + shift, 0, orderRef.current.length - 1);
    const currentIndex = orderRef.current.indexOf(tabId);
    if (newIndex !== currentIndex) {
      const next = orderRef.current.filter((id) => id !== tabId);
      next.splice(newIndex, 0, tabId);
      orderRef.current = next;
      bumpVersion();
    }
    // The tab's DOM slot already absorbed indexDelta * TAB_WIDTH of the
    // pointer's travel via the reorder above — only the remainder needs to
    // be made up with a transform, so the tab always sits exactly under
    // the cursor regardless of how many times it's been re-slotted.
    const indexDelta = newIndex - info.originIndex;
    const remaining = totalDx - indexDelta * TAB_WIDTH;
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
        aria-label="QueckSilver — quecksilver.ch"
        className="group relative flex h-7 w-7 shrink-0 items-center justify-center self-center [-webkit-app-region:no-drag]"
      >
        <span className="pointer-events-none absolute -inset-1 rounded-lg transition-colors group-hover:bg-black/[0.06]" />
        <QueckSilverLogo className="relative h-5 w-auto" style={{ color: "var(--brand)" }} />
      </button>

      {/* pl-2.5/pr-2.5 leave room for the active tab's left/right notches —
          without them, a notch's -10px offset gets clipped by this
          container's own scroll edge whenever that tab is first (left) or
          last (right) in the list — the common single-tab case hits both
          at once. Divider visibility is driven by React state (hoveredId),
          not a CSS sibling trick — that only ever hid one side reliably. */}
      <div className="flex min-w-0 items-end gap-0 self-end overflow-x-auto pl-2.5 pr-2.5 [-webkit-app-region:no-drag]">
        {orderedTabs.map((tab, i) => {
          const active = tab.id === activeId;
          const prevActive = i > 0 && orderedTabs[i - 1]?.id === activeId;
          const prevId = i > 0 ? orderedTabs[i - 1]?.id : undefined;
          const dividerHidden = hoveredId !== null && (hoveredId === tab.id || hoveredId === prevId);
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
                    ? `relative flex ${TAB_HEIGHT} shrink-0 cursor-pointer select-none items-center gap-2 self-end rounded-t-[10px] bg-background px-2.5`
                    : `flex ${TAB_HEIGHT} shrink-0 cursor-pointer select-none items-center gap-2 self-end rounded-t-lg px-2.5 text-muted-foreground transition-colors hover:bg-foreground/5`
                }
                style={{ width: TAB_WIDTH, touchAction: "none", WebkitUserDrag: "none" } as React.CSSProperties}
              >
                {active && (
                  <>
                    <TabNotch side="left" />
                    <TabNotch side="right" />
                  </>
                )}
                <TabIcon tab={tab} loading={loadingTabIds.has(tab.id)} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                  {tab.isHome ? "New Tab" : tab.isSettings ? "Settings" : tab.title || tab.url}
                </span>
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
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={onNewTab}
        aria-label="New tab"
        className="-ml-1 mb-1.5 flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-lg text-black transition-colors hover:bg-black/10 [-webkit-app-region:no-drag]"
      >
        <Plus className="h-4 w-4" />
      </button>

      <div className="flex-1 self-center [-webkit-app-region:drag]" />

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

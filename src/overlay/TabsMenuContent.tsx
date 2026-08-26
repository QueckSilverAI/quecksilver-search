// The dropdown opened from the chevron button (top-left in horizontal
// mode, above the tab list in the vertical sidebar). Top to bottom: the
// "Enable vertical tabs" toggle, a search field to filter the tab list,
// then two collapsible sections — currently open tabs, and recently
// closed tabs (clicking a closed one reopens it) — each filtered by
// that same search. Same plain-div "belowRight" popover pattern as
// FolderContentsContent.tsx, not a Dialog — this hangs off one button,
// it doesn't need to cover the window.
import { useState } from "react";
import {
  ChevronDown,
  Globe,
  PanelLeft,
  Search,
  Settings as SettingsIcon,
  Search as SearchIcon,
} from "lucide-react";
import type { TabsMenuOverlayAction, TabsMenuOverlayPayload } from "@/overlay/types";
import { Input } from "@/components/ui/input";

function TabFavicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  let src: string | null = null;
  if (!failed) {
    try {
      const host = new URL(url).hostname;
      src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    } catch {
      src = null;
    }
  }
  if (!src) return <Globe className="h-4 w-4 shrink-0 text-foreground" />;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className="h-4 w-4 shrink-0 rounded-sm"
    />
  );
}

// "claude.ai/chat/3456789876543wsdcfvg" -> "claude.ai" — just the host, no
// path/query, so the second line under the title stays short and scannable
// no matter how deep the actual page URL is.
function hostFor(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// "Vor x Sek/Min/Std" in English, matching every other relative-time label
// in this app (frequent sites, history, etc.) — coarse buckets, not exact
// seconds, so it doesn't need to re-render every tick to stay honest.
function timeAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "Just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

// Small uppercase section header with a collapse chevron — used for both
// "Open tabs" and "Recently closed" below. A plain button (not a
// <summary>/<details>) so its open/closed state can be driven from this
// component's own useState, same as every other toggle in this file.
function SectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-1 text-left hover:bg-muted"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <ChevronDown
        className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
      />
    </button>
  );
}

export function TabsMenuContent({
  payload,
  onAction,
}: {
  payload: TabsMenuOverlayPayload;
  onAction: (action: TabsMenuOverlayAction) => void;
}) {
  const [query, setQuery] = useState("");
  const [openTabsExpanded, setOpenTabsExpanded] = useState(true);
  const [closedExpanded, setClosedExpanded] = useState(true);
  const q = query.trim().toLowerCase();
  const filteredTabs = q
    ? payload.tabs.filter((t) => (t.title || t.url).toLowerCase().includes(q))
    : payload.tabs;
  const recentlyClosed = payload.recentlyClosed ?? [];
  const filteredClosed = q
    ? recentlyClosed.filter((t) => (t.title || t.url).toLowerCase().includes(q))
    : recentlyClosed;

  return (
    // No box-shadow here on purpose — same reasoning as
    // FolderContentsContent.tsx's popovers: the native overlay window is
    // sized exactly to this content's measured bounding box, so a
    // shadow paints outside that box and gets hard-clipped right at the
    // window edge instead of fading — that's what produced the
    // shadow-artifact at the bottom corners. The border alone is enough.
    <div className="w-[260px] overflow-hidden rounded-xl border border-border bg-background p-1.5">
      {/* Plain clickable row, no checkbox/checkmark and no slider — the
          row itself just tints when the setting is on. A small logo/icon
          up front so this reads as an app-level toggle, not a generic
          menu item. */}
      <button
        type="button"
        role="switch"
        aria-checked={payload.verticalTabsEnabled}
        onClick={() =>
          onAction({ type: "toggleVerticalTabs", enabled: !payload.verticalTabsEnabled })
        }
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
          payload.verticalTabsEnabled ? "bg-muted" : "hover:bg-muted"
        }`}
      >
        <PanelLeft className="h-4 w-4 shrink-0 text-foreground" />
        <span className="text-[13px] font-medium text-foreground">
          {payload.verticalTabsEnabled ? "Disable vertical tabs" : "Enable vertical tabs"}
        </span>
      </button>

      <div className="my-1 h-px bg-border" />

      {/* Same pill as Settings' "Search downloads"/"Search passwords"
          fields: rounded-full Input with the icon absolutely positioned
          over the left padding, rather than the old flat chrome-field
          row — keeps every search affordance in the app looking like the
          same control. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tabs"
          className="h-9 rounded-full pl-9 text-[13px]"
        />
      </div>

      {/* mt-3 (was mt-1) — noticeably more breathing room between the
          search field and the first row below it than between rows
          within a section. */}
      <div className="mt-3 max-h-[320px] overflow-y-auto">
        <SectionHeader
          label="Open tabs"
          open={openTabsExpanded}
          onToggle={() => setOpenTabsExpanded((v) => !v)}
        />
        {openTabsExpanded &&
          (filteredTabs.length === 0 ? (
            <p className="px-2.5 py-3 text-center text-[13px] text-muted-foreground">
              {payload.tabs.length === 0 ? "No open tabs" : "No matches"}
            </p>
          ) : (
            filteredTabs.map((t) => {
              const label = t.isHome ? "New Tab" : t.isSettings ? "Settings" : t.title || t.url;
              const host = !t.isHome && !t.isSettings ? hostFor(t.url) : null;
              return (
                <button
                  key={t.id}
                  onClick={() => onAction({ type: "switch", id: t.id })}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left ${t.isActive ? "bg-muted" : "hover:bg-muted"}`}
                >
                  {t.isSettings ? (
                    <SettingsIcon className="h-4 w-4 shrink-0 text-foreground" />
                  ) : t.isHome ? (
                    <SearchIcon className="h-4 w-4 shrink-0 text-foreground" />
                  ) : (
                    <TabFavicon url={t.url} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">{label}</span>
                    {host && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {host} · {timeAgo(t.openedAt)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          ))}

        <SectionHeader
          label="Recently closed"
          open={closedExpanded}
          onToggle={() => setClosedExpanded((v) => !v)}
        />
        {closedExpanded &&
          (filteredClosed.length === 0 ? (
            <p className="px-2.5 py-3 text-center text-[13px] text-muted-foreground">
              No recently closed tabs
            </p>
          ) : (
            filteredClosed.map((t) => {
              const label = t.title || t.url;
              const host = hostFor(t.url);
              return (
                <button
                  key={t.id}
                  onClick={() => onAction({ type: "reopenClosed", id: t.id })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-muted"
                >
                  <TabFavicon url={t.url} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">{label}</span>
                    {host && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {host} · {timeAgo(t.closedAt)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          ))}
      </div>
    </div>
  );
}

// The dropdown opened from the chevron button (top-left in horizontal
// mode, above the tab list in the vertical sidebar). Top to bottom: the
// "Enable vertical tabs" toggle, a search field to filter the tab list,
// then the list of open tabs (filtered by that search) — each row
// showing that site's real favicon (falling back to a generic globe if
// it fails to load). Same plain-div "belowRight" popover pattern as
// FolderContentsContent.tsx, not a Dialog — this hangs off one button,
// it doesn't need to cover the window.
import { useState } from "react";
import { Globe, Search, Settings as SettingsIcon, Search as SearchIcon } from "lucide-react";
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
  if (!src) return <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />;
  return <img src={src} alt="" draggable={false} onError={() => setFailed(true)} className="h-4 w-4 shrink-0 rounded-sm" />;
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

export function TabsMenuContent({ payload, onAction }: { payload: TabsMenuOverlayPayload; onAction: (action: TabsMenuOverlayAction) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filteredTabs = q ? payload.tabs.filter((t) => (t.title || t.url).toLowerCase().includes(q)) : payload.tabs;

  return (
    // No box-shadow here on purpose — same reasoning as
    // FolderContentsContent.tsx's popovers: the native overlay window is
    // sized exactly to this content's measured bounding box, so a
    // shadow paints outside that box and gets hard-clipped right at the
    // window edge instead of fading — that's what produced the
    // shadow-artifact at the bottom corners. The border alone is enough.
    <div className="w-[260px] overflow-hidden rounded-xl border border-border bg-background p-1.5">
      {/* Plain clickable row, no checkbox/checkmark and no slider — the
          row itself just tints when the setting is on. */}
      <button
        type="button"
        role="switch"
        aria-checked={payload.verticalTabsEnabled}
        onClick={() => onAction({ type: "toggleVerticalTabs", enabled: !payload.verticalTabsEnabled })}
        className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
          payload.verticalTabsEnabled ? "bg-muted" : "hover:bg-muted"
        }`}
      >
        <span className="text-[13px] font-medium text-foreground">Enable vertical tabs</span>
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

      <div className="mt-1 max-h-[280px] overflow-y-auto">
        {filteredTabs.map((t) => {
          const label = t.isHome ? "New Tab" : t.isSettings ? "Settings" : t.title || t.url;
          const host = !t.isHome && !t.isSettings ? hostFor(t.url) : null;
          return (
            <button
              key={t.id}
              onClick={() => onAction({ type: "switch", id: t.id })}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left ${t.isActive ? "bg-muted" : "hover:bg-muted"}`}
            >
              {t.isSettings ? (
                <SettingsIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : t.isHome ? (
                <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
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
        })}
        {filteredTabs.length === 0 && (
          <p className="px-2.5 py-3 text-center text-[13px] text-muted-foreground">{payload.tabs.length === 0 ? "No open tabs" : "No matches"}</p>
        )}
      </div>
    </div>
  );
}

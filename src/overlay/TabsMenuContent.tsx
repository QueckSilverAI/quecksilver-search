// The dropdown opened from the chevron button at the top-left of TabStrip
// (replaced the old plain QueckSilver-logo button — see TabStrip.tsx).
// Deliberately just two things, top to bottom: the "Enable vertical tabs"
// toggle, then the list of every currently open tab. Same "belowRight"
// plain-div popover pattern as FolderContentsContent.tsx, not a Dialog —
// this hangs off one button, it doesn't need to cover the window.
import { Globe, Settings as SettingsIcon, Search as SearchIcon } from "lucide-react";
import type { TabsMenuOverlayAction, TabsMenuOverlayPayload } from "@/overlay/types";

export function TabsMenuContent({ payload, onAction }: { payload: TabsMenuOverlayPayload; onAction: (action: TabsMenuOverlayAction) => void }) {
  return (
    <div className="w-[260px] overflow-hidden rounded-xl border border-border bg-background p-1.5 shadow-lg">
      <label className="flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted">
        <span className="text-[13px] font-medium text-foreground">Enable vertical tabs</span>
        <input
          type="checkbox"
          checked={payload.verticalTabsEnabled}
          onChange={(e) => onAction({ type: "toggleVerticalTabs", enabled: e.target.checked })}
          className="h-4 w-4 shrink-0 accent-[var(--brand)]"
        />
      </label>

      <div className="my-1 h-px bg-border" />

      <div className="max-h-[280px] overflow-y-auto">
        {payload.tabs.map((t) => (
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
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{t.isHome ? "New Tab" : t.isSettings ? "Settings" : t.title || t.url}</span>
          </button>
        ))}
        {payload.tabs.length === 0 && <p className="px-2.5 py-3 text-center text-[13px] text-muted-foreground">No open tabs</p>}
      </div>
    </div>
  );
}

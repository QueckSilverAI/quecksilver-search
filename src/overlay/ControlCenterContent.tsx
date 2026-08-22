// Renders in the same slot the old TabsMenuContent used to (kind
// "tabsMenu", opened from the Control-center button top-left — see
// TabStrip.tsx/VerticalTabsSidebar.tsx's onOpenTabsMenu). Top section is
// the original minimal tab list + "Enable vertical tabs" toggle, kept so
// nothing that already worked disappears; below that is the full Control
// center grid covering all 24 requested toggles/actions, grouped into
// six small categories.
//
// Every toggle/action below goes through `notify` (= overlay's
// notifyAction, doesn't close the dropdown) rather than `onAction` (=
// sendAction, closes it) — a person flipping five settings in a row
// shouldn't have to reopen this menu five times. Only picking a tab from
// the list at the top still closes it, same as before.
//
// Two distinct row types by design (per explicit request): STATE toggles
// (dark mode, master mute, ad-blocker, ...) render as an iOS-style Switch
// — flipping a mode shouldn't feel like "clicking a button". One-shot
// ACTIONS (open devtools, clear cache, screenshot, ...) stay plain
// clickable buttons — there's no "on/off" for those, just "do it now".
import { useState } from "react";
import {
  ChevronDown,
  Globe,
  Search,
  Settings as SettingsIcon,
  Search as SearchIcon,
  ShieldBan,
  FileCode2,
  Cookie,
  EyeOff,
  Video,
  Mic,
  MapPin,
  PlayCircle,
  MousePointerSquareDashed,
  Wifi,
  ShieldCheck,
  Gauge,
  ListX,
  Cpu,
  Trash2,
  VolumeX,
  Moon,
  ZoomIn,
  ZoomOut,
  Focus,
  Code2,
  RotateCcw,
  Camera,
  QrCode,
  Printer,
  Languages,
  AlertTriangle,
} from "lucide-react";
import { TRANSLATE_LANGUAGES } from "../../shared/translate-languages";
import type {
  ControlCenterActionRequest,
  ControlCenterSettings,
  NetworkThrottlePreset,
  TabsMenuOverlayAction,
  TabsMenuOverlayPayload,
} from "@/overlay/types";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

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

function hostFor(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

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

// Compact category header for the control grid below — smaller/quieter
// than SectionHeader since these six groups sit one after another with no
// collapse behaviour, just a scannable label.
function CategoryLabel({ label }: { label: string }) {
  return (
    <p className="mb-1 mt-3 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
      {label}
    </p>
  );
}

// A STATE row — icon, label, and an iOS-style Switch on the right. The
// row itself isn't clickable (no button-press feel for a mode); only the
// switch is, same as flipping a setting in iOS Control Center.
function ToggleRow({
  icon: Icon,
  label,
  checked,
  onChange,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  badge?: string;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg px-2.5 py-2">
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${checked ? "text-foreground" : "text-muted-foreground"}`}
      />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
        {label}
      </span>
      {badge && (
        <span
          title="Restart required"
          className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600"
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          {badge}
        </span>
      )}
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </label>
  );
}

// A one-shot ACTION row — the whole row is a plain clickable button, no
// on/off state to represent.
function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
        {label}
      </span>
    </button>
  );
}

const THROTTLE_OPTIONS: { id: NetworkThrottlePreset; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "slow3g", label: "Slow 3G" },
  { id: "fast3g", label: "Fast 3G" },
  { id: "offline", label: "Offline" },
];

export function ControlCenterContent({
  payload,
  onAction,
  onNotify,
}: {
  payload: TabsMenuOverlayPayload;
  onAction: (action: TabsMenuOverlayAction) => void;
  onNotify: (action: TabsMenuOverlayAction) => void;
}) {
  const [query, setQuery] = useState("");
  const [openTabsExpanded, setOpenTabsExpanded] = useState(false);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showTranslate, setShowTranslate] = useState(false);
  const [langQuery, setLangQuery] = useState("");
  const lq = langQuery.trim().toLowerCase();
  const filteredLanguages = lq
    ? TRANSLATE_LANGUAGES.filter((l) => l.name.toLowerCase().includes(lq))
    : TRANSLATE_LANGUAGES;
  const q = query.trim().toLowerCase();
  const filteredTabs = q
    ? payload.tabs.filter((t) => (t.title || t.url).toLowerCase().includes(q))
    : payload.tabs;
  const recentlyClosed = payload.recentlyClosed ?? [];
  const filteredClosed = q
    ? recentlyClosed.filter((t) => (t.title || t.url).toLowerCase().includes(q))
    : recentlyClosed;

  const cc = payload.controlCenter;
  const set = (patch: Partial<ControlCenterSettings>) => onNotify({ type: "cc:set", patch });
  const act = (request: ControlCenterActionRequest) => onNotify({ type: "cc:action", request });
  const activeTab = payload.tabs.find((t) => t.isActive);

  const zoomPct = Math.round((cc.globalZoomFactor || 1) * 100);

  return (
    <div className="w-[400px] overflow-hidden rounded-xl border border-border bg-background p-1.5">
      {/* --- Tabs (unchanged from the old chevron dropdown) ---------------- */}
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
        <MousePointerSquareDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">
          {payload.verticalTabsEnabled ? "Disable vertical tabs" : "Enable vertical tabs"}
        </span>
      </button>

      <div className="my-1 h-px bg-border" />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tabs"
          className="h-9 rounded-full pl-9 text-[13px]"
        />
      </div>

      <div className="mt-2 max-h-[220px] overflow-y-auto">
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
              const label = t.isHome ? "New tab" : t.isSettings ? "Settings" : t.title || t.url;
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

      <div className="my-1 h-px bg-border" />

      {/* --- Control center grid ------------------------------------------- */}
      <div className="max-h-[420px] overflow-y-auto pb-1">
        <CategoryLabel label="Network & content" />
        <div className="grid grid-cols-2 gap-0.5">
          <ToggleRow
            icon={ShieldBan}
            label="Ad blocker"
            checked={cc.adBlockEnabled}
            onChange={(v) => set({ adBlockEnabled: v })}
          />
          <ToggleRow
            icon={EyeOff}
            label="Do Not Track"
            checked={cc.doNotTrack}
            onChange={(v) => set({ doNotTrack: v })}
          />
          <ToggleRow
            icon={FileCode2}
            label="Disable JavaScript"
            checked={cc.javascriptDisabled}
            onChange={(v) => set({ javascriptDisabled: v })}
          />
          <ToggleRow
            icon={Cookie}
            label="Block cookies"
            checked={cc.cookiesBlocked}
            onChange={(v) => set({ cookiesBlocked: v })}
          />
          <ToggleRow
            icon={MousePointerSquareDashed}
            label="Block popups"
            checked={cc.popupBlock}
            onChange={(v) => set({ popupBlock: v })}
          />
          <ToggleRow
            icon={PlayCircle}
            label="Block autoplay"
            checked={cc.autoplayBlock}
            onChange={(v) => set({ autoplayBlock: v })}
            badge="Restart"
          />
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <Gauge className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12.5px] font-medium text-foreground">Network throttling</span>
          <div className="ml-auto flex gap-1">
            {THROTTLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  set({ networkThrottle: opt.id });
                  act({ type: "setNetworkThrottle", preset: opt.id });
                }}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  cc.networkThrottle === opt.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <CategoryLabel label="Permissions" />
        <div className="grid grid-cols-2 gap-0.5">
          <ToggleRow
            icon={Video}
            label="Block camera"
            checked={cc.cameraGlobalBlock}
            onChange={(v) => set({ cameraGlobalBlock: v })}
          />
          <ToggleRow
            icon={Mic}
            label="Block microphone"
            checked={cc.micGlobalBlock}
            onChange={(v) => set({ micGlobalBlock: v })}
          />
          <ToggleRow
            icon={MapPin}
            label="Block location"
            checked={cc.locationGlobalBlock}
            onChange={(v) => set({ locationGlobalBlock: v })}
          />
        </div>

        <CategoryLabel label="VPN & security" />
        <div className="grid grid-cols-2 gap-0.5">
          <ToggleRow
            icon={ShieldCheck}
            label="VPN (Tor)"
            checked={cc.vpnEnabled}
            onChange={(v) => set({ vpnEnabled: v })}
          />
          <ToggleRow
            icon={Wifi}
            label="DNS over HTTPS"
            checked={cc.dnsOverHttpsEnabled}
            onChange={(v) => set({ dnsOverHttpsEnabled: v })}
          />
        </div>

        <CategoryLabel label="Performance" />
        <div className="grid grid-cols-2 gap-0.5">
          <ActionButton
            icon={ListX}
            label="Unload tab"
            onClick={() => act({ type: "unloadTab" })}
          />
          <ActionButton
            icon={ListX}
            label="Unload background tabs"
            onClick={() => act({ type: "unloadAllBackgroundTabs" })}
          />
          <ToggleRow
            icon={Cpu}
            label="Throttle background tabs"
            checked={cc.backgroundTabsThrottled}
            onChange={(v) => set({ backgroundTabsThrottled: v })}
          />
          <ToggleRow
            icon={Cpu}
            label="Hardware acceleration"
            checked={cc.hardwareAcceleration}
            onChange={(v) => set({ hardwareAcceleration: v })}
            badge="Restart"
          />
        </div>

        <CategoryLabel label="Display" />
        <div className="grid grid-cols-2 gap-0.5">
          <ToggleRow
            icon={VolumeX}
            label="Master mute"
            checked={cc.masterMute}
            onChange={(v) => set({ masterMute: v })}
          />
          <ToggleRow
            icon={Moon}
            label="Force dark mode"
            checked={cc.darkModeForced}
            onChange={(v) => set({ darkModeForced: v })}
          />
          <ToggleRow
            icon={Focus}
            label="Focus mode"
            checked={cc.focusMode}
            onChange={(v) => set({ focusMode: v })}
          />
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="text-[12.5px] font-medium text-foreground">Font size / zoom</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() =>
                set({
                  globalZoomFactor: Math.max(
                    0.5,
                    Math.round((cc.globalZoomFactor - 0.1) * 10) / 10,
                  ),
                })
              }
              className="flex h-6 w-6 items-center justify-center rounded-full bg-muted hover:bg-muted/70"
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            <span className="w-9 text-center text-[11px] tabular-nums text-muted-foreground">
              {zoomPct}%
            </span>
            <button
              onClick={() =>
                set({
                  globalZoomFactor: Math.min(2, Math.round((cc.globalZoomFactor + 0.1) * 10) / 10),
                })
              }
              className="flex h-6 w-6 items-center justify-center rounded-full bg-muted hover:bg-muted/70"
            >
              <ZoomIn className="h-3 w-3" />
            </button>
          </div>
        </div>

        <CategoryLabel label="Tools" />
        <div className="grid grid-cols-2 gap-0.5">
          <ActionButton
            icon={Code2}
            label="Open DevTools"
            onClick={() => act({ type: "openDevTools" })}
          />
          <ActionButton
            icon={RotateCcw}
            label="Reload without cache"
            onClick={() => act({ type: "reloadNoCache" })}
          />
          <ActionButton
            icon={Trash2}
            label="Clear cache"
            onClick={() => act({ type: "clearCache" })}
          />
          <ActionButton
            icon={Camera}
            label="Screenshot"
            onClick={() => act({ type: "screenshot" })}
          />
          <ActionButton icon={QrCode} label="QR code of URL" onClick={() => setShowQr((v) => !v)} />
          <ActionButton
            icon={Printer}
            label="Print / Save as PDF"
            onClick={() => act({ type: "printPdf" })}
          />
          <ActionButton
            icon={Languages}
            label="Seite übersetzen"
            onClick={() => setShowTranslate((v) => !v)}
          />
        </div>
        {showTranslate && (
          <div className="mt-1 flex flex-col gap-1.5 px-1 py-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={langQuery}
                onChange={(e) => setLangQuery(e.target.value)}
                placeholder="Sprache suchen"
                className="h-8 rounded-full pl-9 text-[12.5px]"
                autoFocus
              />
            </div>
            <div className="max-h-[160px] overflow-y-auto">
              {filteredLanguages.length === 0 ? (
                <p className="px-2.5 py-2 text-center text-[12.5px] text-muted-foreground">
                  Keine Treffer
                </p>
              ) : (
                filteredLanguages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() =>
                      onAction({
                        type: "cc:action",
                        request: { type: "translatePage", langCode: lang.code },
                      })
                    }
                    className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-foreground hover:bg-muted"
                  >
                    {lang.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        {showQr && activeTab && !activeTab.isHome && !activeTab.isSettings && (
          <div className="flex flex-col items-center gap-1.5 px-2.5 py-2">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(activeTab.url)}`}
              alt="QR code for the current page"
              className="h-[160px] w-[160px] rounded-lg border border-border"
            />
            <span className="max-w-[300px] truncate text-[11px] text-muted-foreground">
              {activeTab.url}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[11.5px]">
            Console errors (all tabs): {payload.consoleErrorTotal}
          </span>
        </div>
      </div>
    </div>
  );
}

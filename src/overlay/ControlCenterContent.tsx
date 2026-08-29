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
import { useEffect, useState } from "react";
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
  ImageOff,
  Zap,
  BellOff,
  Pipette,
  BatteryLow,
  Contrast,
  MousePointer2,
  PictureInPicture2,
  Grid3x3,
  Radio,
  Volume2,
  KeyRound,
  Fingerprint,
  Lock,
  ShieldAlert,
  Radar,
  BookOpen,
  Palette,
  Images,
  FileDown,
  FileSearch,
  Crosshair,
  Smartphone,
  ListTree,
  FileText,
  Database,
  ServerCog,
  FileArchive,
  Webhook,
  AlertOctagon,
} from "lucide-react";
import { TRANSLATE_LANGUAGES } from "../../shared/translate-languages";
import { decodeJwt } from "../../shared/jwt-decode";
import type {
  ControlCenterActionRequest,
  ControlCenterSettings,
  DeviceEmulationPreset,
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

// Control center's "Bandbreiten-Nutzung" (masterplan #10) display line.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  { id: "custom", label: "Custom" },
];

const DOH_PROVIDER_OPTIONS: { id: ControlCenterSettings["dnsOverHttpsProvider"]; label: string }[] = [
  { id: "cloudflare", label: "Cloudflare" },
  { id: "quad9", label: "Quad9" },
  { id: "google", label: "Google" },
];

const VISION_FILTER_OPTIONS: { id: ControlCenterSettings["visionFilter"]; label: string }[] = [
  { id: "none", label: "Off" },
  { id: "high-contrast", label: "High contrast" },
  { id: "protanopia", label: "Protanopia" },
  { id: "deuteranopia", label: "Deuteranopia" },
  { id: "tritanopia", label: "Tritanopia" },
];

const CURSOR_SIZE_OPTIONS: { id: ControlCenterSettings["cursorSize"]; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "large", label: "Large" },
  { id: "xlarge", label: "Extra large" },
];

const USER_AGENT_OPTIONS: { id: ControlCenterSettings["userAgentPreset"]; label: string }[] = [
  { id: "default", label: "Standard" },
  { id: "chrome-win", label: "Chrome/Windows" },
  { id: "safari-ios", label: "Safari/iOS" },
  { id: "firefox-linux", label: "Firefox/Linux" },
];

const DEVICE_PRESET_OPTIONS: { id: DeviceEmulationPreset; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "iphone14", label: "iPhone 14" },
  { id: "ipad", label: "iPad" },
  { id: "desktop-sm", label: "Desktop" },
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
  const [showJwt, setShowJwt] = useState(false);
  const [jwtInput, setJwtInput] = useState("");
  const decodedJwt = jwtInput.trim() ? decodeJwt(jwtInput) : null;
  const [showCustomCss, setShowCustomCss] = useState(false);
  const [cssInput, setCssInput] = useState("");
  const customCssTarget = payload.customCssForActiveTab;
  // Keeps the textarea in sync with whatever's actually saved whenever the
  // active tab/domain changes — but only while the editor is closed, so
  // typing isn't clobbered by the background poll while it's open.
  useEffect(() => {
    if (!showCustomCss) setCssInput(customCssTarget?.css ?? "");
  }, [customCssTarget, showCustomCss]);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showBlockedPatterns, setShowBlockedPatterns] = useState(false);
  const [blockedPatternsInput, setBlockedPatternsInput] = useState("");
  // DevTools panels (masterplan #26/#29/#30/#31/#32/#34) — each toggled
  // open independently; data itself lives in payload.*Result (fetched
  // lazily on open, see the ActionButtons further down).
  const [showRequestLog, setShowRequestLog] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [showIndexedDb, setShowIndexedDb] = useState(false);
  const [showServiceWorker, setShowServiceWorker] = useState(false);
  const [showMocks, setShowMocks] = useState(false);
  const [newCookieName, setNewCookieName] = useState("");
  const [newCookieValue, setNewCookieValue] = useState("");
  const [mockPattern, setMockPattern] = useState("");
  const [mockStatus, setMockStatus] = useState("200");
  const [mockBody, setMockBody] = useState("");
  // HAR recording (masterplan #32) is local-only UI state — the actual
  // recording lives in tab-manager.ts, this just tracks what the button
  // should say/do next.
  const [harRecording, setHarRecording] = useState(false);
  // Not part of ControlCenterSettings (cc) — device emulation is per-tab,
  // ephemeral state tracked in TabManager itself, not a persisted
  // setting, so it's tracked locally here rather than read off cc.
  const [devicePreset, setDevicePreset] = useState<DeviceEmulationPreset>("off");
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

  // Masterplan #33 — keeps the textarea in sync with what's actually
  // saved whenever it changes, but only while the editor is closed, same
  // reasoning as the Custom CSS textarea further up.
  useEffect(() => {
    if (!showBlockedPatterns) setBlockedPatternsInput(cc.customBlockedPatterns.join("\n"));
  }, [cc.customBlockedPatterns, showBlockedPatterns]);

  const zoomPct = Math.round((cc.globalZoomFactor || 1) * 100);

  // Uses the native browser EyeDropper API directly in this overlay's own
  // renderer — no Electron/main-process round-trip needed, unlike almost
  // everything else in this file. Supported by the Chromium version every
  // current Electron release ships; silently no-ops (button does nothing)
  // on the rare build where it's unavailable, and swallows the
  // AbortError EyeDropper throws when the person presses Escape instead
  // of clicking a pixel.
  const pickColor = async () => {
    const EyeDropperCtor = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropperCtor) return;
    try {
      const result = await new EyeDropperCtor().open();
      await navigator.clipboard.writeText(result.sRGBHex);
    } catch {
      /* cancelled — nothing to do */
    }
  };

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
        <CategoryLabel label="Privacy & Security" />
        <div className="grid grid-cols-2 gap-0.5">
          <ToggleRow
            icon={Radar}
            label="WebRTC protection"
            checked={cc.webrtcLeakProtection}
            onChange={(v) => set({ webrtcLeakProtection: v })}
            badge="Restart"
          />
          <ToggleRow
            icon={Lock}
            label="HTTPS-only mode"
            checked={cc.httpsOnlyEnforced}
            onChange={(v) => set({ httpsOnlyEnforced: v })}
          />
          <ToggleRow
            icon={Cookie}
            label="Cookie auto-delete"
            checked={cc.cookieAutoDelete}
            onChange={(v) => set({ cookieAutoDelete: v })}
          />
        </div>
        {payload.currentSiteSafety !== "unknown" && (
          <p className="flex items-center gap-2 px-2.5 py-1 text-[11px] text-muted-foreground">
            {payload.currentSiteSafety === "safe" ? (
              <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
            )}
            {payload.currentSiteSafety === "safe" ? "This site is safe" : "This site looks suspicious"}
          </p>
        )}

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
          <ToggleRow
            icon={ImageOff}
            label="Disable images"
            checked={cc.imagesDisabled}
            onChange={(v) => set({ imagesDisabled: v })}
          />
        </div>
        {payload.trackerCountForActiveTab > 0 && (
          <p className="flex items-center gap-2 px-2.5 py-1 text-[11px] text-muted-foreground">
            <ShieldBan className="h-3 w-3 shrink-0" />
            {payload.trackerCountForActiveTab} trackers blocked on this page
          </p>
        )}
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
        {cc.networkThrottle === "custom" && (
          <div className="flex items-center gap-1.5 px-2.5 py-1">
            <input
              type="number"
              value={cc.customDownloadKbps}
              onChange={(e) => set({ customDownloadKbps: Number(e.target.value) || 0 })}
              onBlur={() => act({ type: "setNetworkThrottle", preset: "custom" })}
              className="w-16 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none"
              title="Download kbps"
            />
            <span className="text-[10px] text-muted-foreground">kbps↓</span>
            <input
              type="number"
              value={cc.customUploadKbps}
              onChange={(e) => set({ customUploadKbps: Number(e.target.value) || 0 })}
              onBlur={() => act({ type: "setNetworkThrottle", preset: "custom" })}
              className="w-16 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none"
              title="Upload kbps"
            />
            <span className="text-[10px] text-muted-foreground">kbps↑</span>
            <input
              type="number"
              value={cc.customLatencyMs}
              onChange={(e) => set({ customLatencyMs: Number(e.target.value) || 0 })}
              onBlur={() => act({ type: "setNetworkThrottle", preset: "custom" })}
              className="w-16 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none"
              title="Latency ms"
            />
            <span className="text-[10px] text-muted-foreground">ms latency</span>
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <ShieldBan className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12.5px] font-medium text-foreground">Pattern-based request blocking</span>
          <button
            onClick={() => setShowBlockedPatterns((v) => !v)}
            className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/70"
          >
            {cc.customBlockedPatterns.length > 0 ? `${cc.customBlockedPatterns.length} active` : "Edit"}
          </button>
        </div>
        {showBlockedPatterns && (
          <div className="mt-1 flex flex-col gap-1.5 px-2.5 py-1.5">
            <textarea
              value={blockedPatternsInput}
              onChange={(e) => setBlockedPatternsInput(e.target.value)}
              placeholder={"*.analytics.example.com/*\none pattern per line, * as wildcard"}
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-foreground/40"
            />
            <div className="flex justify-end">
              <button
                onClick={() =>
                  set({
                    customBlockedPatterns: blockedPatternsInput
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="rounded-full bg-foreground px-2.5 py-1 text-[11px] font-medium text-background hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        )}
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
          <ToggleRow
            icon={BellOff}
            label="Do not disturb"
            checked={cc.doNotDisturb}
            onChange={(v) => set({ doNotDisturb: v })}
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
          <ToggleRow
            icon={ShieldAlert}
            label="VPN kill switch"
            checked={cc.vpnKillSwitch}
            onChange={(v) => set({ vpnKillSwitch: v })}
          />
        </div>
        {cc.dnsOverHttpsEnabled && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="text-[12.5px] font-medium text-foreground">DNS provider</span>
            <div className="ml-auto flex gap-1">
              {DOH_PROVIDER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => set({ dnsOverHttpsProvider: opt.id })}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    cc.dnsOverHttpsProvider === opt.id
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <Fingerprint className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12.5px] font-medium text-foreground">User-Agent</span>
          <div className="ml-auto flex flex-wrap justify-end gap-1">
            {USER_AGENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => set({ userAgentPreset: opt.id })}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  cc.userAgentPreset === opt.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <ListX className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12.5px] font-medium text-foreground">Auto-Suspend</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => set({ autoSuspendMinutes: Math.max(0, cc.autoSuspendMinutes - 5) })}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-muted hover:bg-muted/70"
            >
              <span className="text-[13px] leading-none">−</span>
            </button>
            <span className="w-14 text-center text-[11px] tabular-nums text-muted-foreground">
              {cc.autoSuspendMinutes === 0 ? "Off" : `${cc.autoSuspendMinutes} min`}
            </span>
            <button
              onClick={() => set({ autoSuspendMinutes: Math.min(180, cc.autoSuspendMinutes + 5) })}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-muted hover:bg-muted/70"
            >
              <span className="text-[13px] leading-none">+</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-0.5">
          <ToggleRow
            icon={Cpu}
            label="Hardware acceleration"
            checked={cc.hardwareAcceleration}
            onChange={(v) => set({ hardwareAcceleration: v })}
            badge="Restart"
          />
          <ToggleRow
            icon={Zap}
            label="Disable preload/prefetch"
            checked={cc.preloadDisabled}
            onChange={(v) => set({ preloadDisabled: v })}
            badge="Restart"
          />
          <ToggleRow
            icon={BatteryLow}
            label="Battery saver mode"
            checked={cc.batterySaverMode}
            onChange={(v) =>
              // A preset, not just its own flag — flipping it on also
              // pulls in the two performance toggles it depends on, in
              // the SAME patch, so main.ts's dnsOverHttps-style "read the
              // sibling field off next" pattern isn't needed here.
              //
              // autoSuspendMinutes is the one that actually matters here:
              // unloadBackgroundTabsOnIdle itself isn't read by anything —
              // tab-manager.ts's checkAutoSuspend() only acts once
              // autoSuspendMinutes is above 0 (see its own comment). Without
              // this, turning Battery saver on left autoSuspendMinutes at
              // whatever it was (0/"Off" by default), so background tabs
              // were still throttled but never actually unloaded — half the
              // preset silently doing nothing. 10 matches the same preset's
              // apply_preset("battery_saver") value in browser-tools.ts, so
              // Zora and this toggle agree on what "battery saver" means.
              set(
                v
                  ? { batterySaverMode: true, backgroundTabsThrottled: true, unloadBackgroundTabsOnIdle: true, autoSuspendMinutes: 10 }
                  : { batterySaverMode: false },
              )
            }
          />
        </div>
        {activeTab && !activeTab.isHome && !activeTab.isSettings && (
          <p className="flex items-center gap-3 px-2.5 py-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Gauge className="h-3 w-3 shrink-0" />
              {formatBytes(payload.bandwidthForActiveTab)} geladen
            </span>
            {payload.resourceUsageForActiveTab && (
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3 shrink-0" />
                {payload.resourceUsageForActiveTab.cpuPercent}% CPU ·{" "}
                {payload.resourceUsageForActiveTab.ramMb} MB RAM
              </span>
            )}
          </p>
        )}

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
          <ToggleRow
            icon={Grid3x3}
            label="Grid overlay"
            checked={cc.gridOverlayEnabled}
            onChange={(v) => set({ gridOverlayEnabled: v })}
          />
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <Contrast className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12.5px] font-medium text-foreground">Contrast / color vision</span>
          <div className="ml-auto flex flex-wrap justify-end gap-1">
            {VISION_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => set({ visionFilter: opt.id })}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  cc.visionFilter === opt.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <MousePointer2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12.5px] font-medium text-foreground">Cursor size</span>
          <div className="ml-auto flex gap-1">
            {CURSOR_SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => set({ cursorSize: opt.id })}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  cc.cursorSize === opt.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
            label="Translate page"
            onClick={() => setShowTranslate((v) => !v)}
          />
          <ActionButton
            icon={Pipette}
            label="Color picker"
            onClick={() => void pickColor()}
          />
          <ActionButton
            icon={PictureInPicture2}
            label="Force picture-in-picture"
            onClick={() => act({ type: "forcePip" })}
          />
          <ActionButton
            icon={Radio}
            label="Pause all media"
            onClick={() => act({ type: "pauseAllMedia" })}
          />
          <ActionButton
            icon={Volume2}
            label="Mute all media"
            onClick={() => act({ type: "muteAllMedia", muted: true })}
          />
          <ActionButton
            icon={KeyRound}
            label="Decode JWT"
            onClick={() => setShowJwt((v) => !v)}
          />
          <ActionButton
            icon={BookOpen}
            label="Reader view"
            onClick={() => act({ type: "toggleReaderMode" })}
          />
          {customCssTarget && (
            <ActionButton
              icon={Palette}
              label="Custom CSS"
              onClick={() => setShowCustomCss((v) => !v)}
            />
          )}
          <ActionButton
            icon={Images}
            label="Full-page screenshot"
            onClick={() => act({ type: "fullPageScreenshot" })}
          />
          <ActionButton
            icon={FileDown}
            label="Export as Markdown"
            onClick={() => act({ type: "exportPageAsMarkdown" })}
          />
          <ActionButton
            icon={FileSearch}
            label="Page metadata"
            onClick={() => {
              setShowMetadata((v) => !v);
              act({ type: "getPageMetadata" });
            }}
          />
          <ActionButton
            icon={Crosshair}
            label="Element picker"
            onClick={() => act({ type: "startElementPicker" })}
          />
        </div>

        <CategoryLabel label="DevTools & Debugging" />
        <div className="grid grid-cols-2 gap-0.5">
          <ToggleRow
            icon={AlertOctagon}
            label="JS error overlay"
            checked={cc.jsErrorOverlayEnabled}
            onChange={(v) => set({ jsErrorOverlayEnabled: v })}
          />
        </div>
        <div className="grid grid-cols-2 gap-0.5">
          <ActionButton
            icon={ListTree}
            label="Request log"
            onClick={() => {
              setShowRequestLog((v) => !v);
              act({ type: "getRequestLog" });
            }}
          />
          <ActionButton
            icon={FileText}
            label="Export console log"
            onClick={() => act({ type: "exportConsoleLog" })}
          />
          <ActionButton
            icon={Cookie}
            label="Cookie viewer"
            onClick={() => {
              setShowCookies((v) => !v);
              act({ type: "getCookiesForTab" });
            }}
          />
          <ActionButton
            icon={Database}
            label="IndexedDB"
            onClick={() => {
              setShowIndexedDb((v) => !v);
              act({ type: "getIndexedDbInfo" });
            }}
          />
          <ActionButton
            icon={ServerCog}
            label="Service workers"
            onClick={() => {
              setShowServiceWorker((v) => !v);
              act({ type: "getServiceWorkerStatus" });
            }}
          />
          <ActionButton
            icon={FileArchive}
            label={harRecording ? "Stop HAR recording" : "Start HAR recording"}
            onClick={() => {
              setHarRecording((v) => !v);
              act({ type: "toggleHarRecording" });
            }}
          />
          <ActionButton
            icon={Webhook}
            label="Request mocking"
            onClick={() => {
              setShowMocks((v) => !v);
              act({ type: "getRequestMocks" });
            }}
          />
        </div>
        {showRequestLog && (
          <div className="mt-1 flex flex-col gap-1 px-2.5 py-1.5">
            {payload.requestLogResult === null ? (
              <p className="px-1 text-[11px] text-muted-foreground">Loading…</p>
            ) : payload.requestLogResult.length === 0 ? (
              <p className="px-1 text-[11px] text-muted-foreground">No requests recorded</p>
            ) : (
              <div className="max-h-[180px] overflow-y-auto">
                {payload.requestLogResult.map((r, i) => (
                  <p key={i} className="truncate text-[11px] text-foreground">
                    <span
                      className={
                        r.statusCode >= 400
                          ? "text-red-600"
                          : r.statusCode >= 300
                            ? "text-amber-600"
                            : "text-emerald-600"
                      }
                    >
                      {r.statusCode || "—"}
                    </span>{" "}
                    <span className="text-muted-foreground">{r.method}</span> {r.url}
                    <span className="text-muted-foreground"> · {r.durationMs}ms</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        {showCookies && (
          <div className="mt-1 flex flex-col gap-1 px-2.5 py-1.5">
            {payload.cookiesResult === null ? (
              <p className="px-1 text-[11px] text-muted-foreground">Loading…</p>
            ) : payload.cookiesResult.length === 0 ? (
              <p className="px-1 text-[11px] text-muted-foreground">No cookies for this page</p>
            ) : (
              <div className="max-h-[160px] overflow-y-auto">
                {payload.cookiesResult.map((c) => (
                  <div key={c.name} className="flex items-center gap-1.5 py-0.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                      <span className="font-medium">{c.name}</span> = {c.value}
                    </span>
                    <button
                      onClick={() => act({ type: "deleteCookie", name: c.name })}
                      className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-1 flex items-center gap-1.5">
              <input
                value={newCookieName}
                onChange={(e) => setNewCookieName(e.target.value)}
                placeholder="Name"
                className="w-1/3 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none"
              />
              <input
                value={newCookieValue}
                onChange={(e) => setNewCookieValue(e.target.value)}
                placeholder="Value"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none"
              />
              <button
                onClick={() => {
                  if (!newCookieName.trim()) return;
                  act({ type: "setCookie", name: newCookieName.trim(), value: newCookieValue });
                  setNewCookieName("");
                  setNewCookieValue("");
                }}
                className="shrink-0 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-medium text-background hover:opacity-90"
              >
                +
              </button>
            </div>
          </div>
        )}
        {showIndexedDb && (
          <div className="mt-1 flex flex-col gap-1 px-2.5 py-1.5">
            {payload.indexedDbResult === null ? (
              <p className="px-1 text-[11px] text-muted-foreground">Loading…</p>
            ) : payload.indexedDbResult.databases.length === 0 ? (
              <p className="px-1 text-[11px] text-muted-foreground">No IndexedDB databases</p>
            ) : (
              payload.indexedDbResult.databases.map((db) => (
                <div key={db.name} className="text-[11px]">
                  <p className="font-medium text-foreground">{db.name}</p>
                  <p className="pl-2 text-muted-foreground">
                    {db.objectStores.length > 0 ? db.objectStores.join(", ") : "— no object stores —"}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
        {showServiceWorker && (
          <div className="mt-1 flex flex-col gap-1.5 px-2.5 py-1.5">
            {payload.serviceWorkerResult === null ? (
              <p className="px-1 text-[11px] text-muted-foreground">Loading…</p>
            ) : payload.serviceWorkerResult.registrations.length === 0 ? (
              <p className="px-1 text-[11px] text-muted-foreground">No service worker registered</p>
            ) : (
              <>
                {payload.serviceWorkerResult.registrations.map((r, i) => (
                  <p key={i} className="truncate text-[11px] text-foreground">
                    <span className={r.active ? "text-emerald-600" : "text-amber-600"}>
                      {r.active ? "active" : "waiting"}
                    </span>{" "}
                    <span className="text-muted-foreground">{r.scope}</span>
                  </p>
                ))}
                <button
                  onClick={() => act({ type: "unregisterServiceWorkers" })}
                  className="mt-1 self-start rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/70"
                >
                  Unregister all
                </button>
              </>
            )}
          </div>
        )}
        {showMocks && (
          <div className="mt-1 flex flex-col gap-1.5 px-2.5 py-1.5">
            {payload.requestMocksResult && payload.requestMocksResult.length > 0 && (
              <div className="max-h-[100px] overflow-y-auto">
                {payload.requestMocksResult.map((m) => (
                  <div key={m.pattern} className="flex items-center gap-1.5 py-0.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                      <span className="font-medium">{m.status}</span> {m.pattern}
                    </span>
                    <button
                      onClick={() => act({ type: "deleteRequestMock", pattern: m.pattern })}
                      className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              value={mockPattern}
              onChange={(e) => setMockPattern(e.target.value)}
              placeholder="URL pattern (* as wildcard)"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none"
            />
            <div className="flex items-center gap-1.5">
              <input
                value={mockStatus}
                onChange={(e) => setMockStatus(e.target.value)}
                placeholder="Status"
                className="w-16 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none"
              />
              <input
                value={mockBody}
                onChange={(e) => setMockBody(e.target.value)}
                placeholder="Response body (JSON)"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none"
              />
              <button
                onClick={() => {
                  if (!mockPattern.trim()) return;
                  act({
                    type: "setRequestMock",
                    pattern: mockPattern.trim(),
                    status: Number(mockStatus) || 200,
                    body: mockBody,
                  });
                  setMockPattern("");
                  setMockBody("");
                }}
                className="shrink-0 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-medium text-background hover:opacity-90"
              >
                +
              </button>
            </div>
          </div>
        )}

        <CategoryLabel label="Device emulation" />
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12.5px] font-medium text-foreground">Device emulation</span>
          <div className="ml-auto flex gap-1">
            {DEVICE_PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  setDevicePreset(opt.id);
                  act({ type: "setDeviceEmulation", preset: opt.id });
                }}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  devicePreset === opt.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {showTranslate && (
          <div className="mt-1 flex flex-col gap-1.5 px-1 py-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={langQuery}
                onChange={(e) => setLangQuery(e.target.value)}
                placeholder="Search language"
                className="h-8 rounded-full pl-9 text-[12.5px]"
                autoFocus
              />
            </div>
            <div className="max-h-[160px] overflow-y-auto">
              {filteredLanguages.length === 0 ? (
                <p className="px-2.5 py-2 text-center text-[12.5px] text-muted-foreground">
                  No matches
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
        {showQr && activeTab && (() => {
          // Home/Settings tabs don't have a real, shareable page URL —
          // their "url" is the internal quecksilver://newtab sentinel (see
          // HOME_URL in electron/types.ts), which would just produce a
          // useless QR code. Falls back to the actual product site instead
          // of hiding the button entirely for those tabs — same URL the
          // logo click already goes to (routes/index.tsx).
          const qrUrl = activeTab.isHome || activeTab.isSettings ? "https://quecksilver.ch" : activeTab.url;
          return (
            <div className="flex flex-col items-center gap-1.5 px-2.5 py-2">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}`}
                alt="QR code for the current page"
                className="h-[160px] w-[160px] rounded-lg border border-border"
              />
              <span className="max-w-[300px] truncate text-[11px] text-muted-foreground">{qrUrl}</span>
            </div>
          );
        })()}
        {showJwt && (
          <div className="mt-1 flex flex-col gap-1.5 px-2.5 py-1.5">
            <textarea
              value={jwtInput}
              onChange={(e) => setJwtInput(e.target.value)}
              placeholder="Paste JWT here…"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-foreground/40"
              autoFocus
            />
            {jwtInput.trim() && (
              decodedJwt ? (
                <div className="max-h-[180px] overflow-y-auto rounded-lg bg-muted px-2.5 py-1.5">
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Header
                  </p>
                  <pre className="whitespace-pre-wrap break-all text-[11px] text-foreground">
                    {JSON.stringify(decodedJwt.header, null, 2)}
                  </pre>
                  <p className="mb-0.5 mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Payload
                  </p>
                  <pre className="whitespace-pre-wrap break-all text-[11px] text-foreground">
                    {JSON.stringify(decodedJwt.payload, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="px-1 text-[11px] text-muted-foreground">Not a valid JWT</p>
              )
            )}
          </div>
        )}
        {showCustomCss && customCssTarget && (
          <div className="mt-1 flex flex-col gap-1.5 px-2.5 py-1.5">
            <p className="px-0.5 text-[11px] text-muted-foreground">
              For <span className="font-medium text-foreground">{customCssTarget.domain}</span>
            </p>
            <textarea
              value={cssInput}
              onChange={(e) => setCssInput(e.target.value)}
              placeholder={"html { }\n/* custom CSS for this domain */"}
              rows={4}
              className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-foreground/40"
              autoFocus
            />
            <div className="flex justify-end gap-1.5">
              <button
                onClick={() => setCssInput("")}
                className="rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
              >
                Clear
              </button>
              <button
                onClick={() =>
                  act({ type: "setCustomCss", domain: customCssTarget.domain, css: cssInput })
                }
                className="rounded-full bg-foreground px-2.5 py-1 text-[11px] font-medium text-background hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        )}
        {showMetadata && (
          <div className="mt-1 flex flex-col gap-1 px-2.5 py-1.5">
            {payload.pageMetadataResult ? (
              <>
                <p className="text-[11px] text-muted-foreground">
                  Title ({payload.pageMetadataResult.titleLength} characters)
                  {payload.pageMetadataResult.titleLength > 60 && (
                    <span className="text-amber-600"> — over 60 characters</span>
                  )}
                </p>
                <p className="truncate text-[12.5px] text-foreground">
                  {payload.pageMetadataResult.title || "—"}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Meta description</p>
                <p className="truncate text-[12.5px] text-foreground">
                  {payload.pageMetadataResult.description || "— missing —"}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Canonical URL</p>
                <p className="truncate text-[12.5px] text-foreground">
                  {payload.pageMetadataResult.canonicalUrl || "— missing —"}
                </p>
                {payload.pageMetadataResult.ogTags.length > 0 && (
                  <>
                    <p className="mt-1 text-[11px] text-muted-foreground">OG tags</p>
                    <div className="max-h-[120px] overflow-y-auto">
                      {payload.pageMetadataResult.ogTags.map((tag, i) => (
                        <p key={i} className="truncate text-[11px] text-foreground">
                          <span className="text-muted-foreground">{tag.property}:</span> {tag.content}
                        </p>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="px-1 text-[11px] text-muted-foreground">Loading…</p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => act({ type: "openDevTools" })}
          title="Open DevTools"
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[11.5px]">
            Console errors (all tabs): {payload.consoleErrorTotal}
          </span>
        </button>
      </div>
    </div>
  );
}

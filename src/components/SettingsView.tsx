import { useEffect, useRef, useState } from "react";
import {
  Bell, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Columns2, Download, Edit3, Eye, EyeOff, FolderOpen, Globe, KeyRound, Link2, Lock, Mic, Monitor,
  Moon, Palette, Plus, PictureInPicture2, RotateCw, Search, Settings as SettingsIcon, ShieldAlert, Star, Sun, Trash2, User, Zap,
} from "lucide-react";
import { useAccentColor, useColorScheme, THEME_COLORS, type ColorScheme } from "@/lib/theme";
import { useSearchEngine, SEARCH_ENGINES, useZoomLevel, useHeaderFavoritesBarVisible } from "@/lib/settings-store";
import { useToolbarStyle, TOOLBAR_STYLES } from "@/lib/toolbar-style";
import { ToolbarActionIcons, type ToolbarAction } from "@/components/ToolbarActionIcons";
import { useHeaderFavorites } from "@/hooks/use-header-favorites";
import { useDownloads } from "@/hooks/use-downloads";
import { useProfiles } from "@/hooks/use-profiles";
import { usePasswords } from "@/hooks/use-passwords";
import { useSitePermissions } from "@/hooks/use-site-permissions";
import { usePrivacySettings, type DohProvider } from "@/hooks/use-privacy-settings";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TorOnionLogo } from "@/components/TorOnionLogo";
import { FavIcon } from "@/components/FavIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { takePendingSettingsAnchor, subscribeSettingsAnchor } from "@/lib/settings-anchor";
import { PageScrollbar } from "@/components/PageScrollbar";
import { ImportProgress } from "@/components/ImportProgress";

// ─── Design primitives — 1:1 from QueckSilver AI's own Settings.tsx ────────
const SettingsCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-2xl bg-card border border-border/60 overflow-hidden shadow-sm ${className}`}>{children}</div>
);
const CardSection = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`px-4 py-3 ${className}`}>{children}</div>
);
const Divider = () => <div className="h-px bg-border/50 mx-4" />;
const Chip = ({ label, selected, onClick, icon }: { label: string; selected: boolean; onClick: () => void; icon?: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-150 ${
      selected ? "border-[var(--brand)] bg-[var(--brand)]/10 text-foreground shadow-sm" : "border-border text-muted-foreground hover:bg-muted"
    }`}
  >
    {icon}
    {label}
  </button>
);

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-14 scroll-mt-8">
      <h2 className="mb-4 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

// Strips a protocol/path off whatever the person typed, so
// "https://example.com/foo" and "example.com" both resolve to the same
// stored permission entry.
function cleanDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

// Click "Record", press a key combo, done — writes an Electron accelerator
// string (e.g. "Control+Shift+Q") directly, since that's exactly what
// globalShortcut.register() on the main-process side needs; no separate
// translation step between what's captured here and what's registered.
function PanicShortcutRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <button
      onClick={() => setRecording(true)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; // wait for a real key, not just the modifier on its own
        const parts: string[] = [];
        if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
        if (e.shiftKey) parts.push("Shift");
        if (e.altKey) parts.push("Alt");
        const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
        parts.push(key);
        onChange(parts.join("+"));
        setRecording(false);
      }}
      onBlur={() => setRecording(false)}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        recording ? "border-[var(--brand)] text-[var(--brand)]" : "border-border text-foreground hover:bg-muted"
      }`}
    >
      {recording ? "Press keys…" : value.replace("CommandOrControl", navigator.platform.includes("Mac") ? "Cmd" : "Ctrl").replace(/\+/g, " + ")}
    </button>
  );
}

const PERMISSION_LABELS: Record<"camera" | "microphone" | "notifications" | "autoDownloads", string> = {
  camera: "Camera",
  microphone: "Microphone",
  notifications: "Notifications",
  autoDownloads: "Automatic downloads",
};
const PERMISSION_ICONS: Record<"camera" | "microphone" | "notifications" | "autoDownloads", React.ReactNode> = {
  camera: <Camera className="h-4 w-4" />,
  microphone: <Mic className="h-4 w-4" />,
  notifications: <Bell className="h-4 w-4" />,
  autoDownloads: <Download className="h-4 w-4" />,
};

// Row now carries an icon in its own small rounded box, matching
// RowLink/RowToggle in the real Settings.tsx — previously these rows had
// no icon at all, one of the concrete things that made this page look
// unlike the rest of the app.
function Row({ icon: Icon, label, description, children }: { icon: React.FC<{ className?: string }>; label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Deliberately flat and minimal — no left sidebar with grouped sections.
// There just aren't enough settings here to justify one; everything fits
// on a single scrollable page, in the order Juri asked for: search/default
// browser, downloads + favorites, import, theme, zoom.
export function SettingsView({ nightModeTabId }: { nightModeTabId?: string | null } = {}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { engine, setEngine } = useSearchEngine();
  const { level: zoomLevel, setLevel: setZoomLevel } = useZoomLevel();
  const { style: toolbarStyle, setStyle: setToolbarStyle } = useToolbarStyle();
  const [toolbarStyleOpen, setToolbarStyleOpen] = useState(false);
  // Sample data for the style picker's live previews — a fixed "split
  // active" state so options showing an active treatment aren't stuck on
  // the plain resting look. The download icon deliberately isn't marked
  // busy here: that used to spin a loading ring in every preview, which
  // was just visual noise for a state that (now that an in-progress
  // download replaces the whole toolbar, see ToolbarActionIcons) these
  // per-style previews don't actually represent anyway.
  const previewActions: ToolbarAction[] = [
    { id: "edit", icon: Edit3, label: "Edit", onClick: () => {} },
    { id: "settings", icon: SettingsIcon, label: "Settings", onClick: () => {} },
    { id: "download", icon: Download, label: "Downloads", onClick: () => {} },
    { id: "pip", icon: PictureInPicture2, label: "Picture-in-Picture", onClick: () => {} },
    { id: "split", icon: Columns2, label: "Split", onClick: () => {}, active: true },
  ];
  const { favorites, add: addFavorite, addMany: addManyFavorites, update: updateFavorite, remove: removeFavorite } = useHeaderFavorites();
  const { visible: headerFavoritesBarVisible, setVisible: setHeaderFavoritesBarVisible } = useHeaderFavoritesBarVisible();
  const { items: downloadItems, folder: downloadFolder, remove: removeDownload, open: openDownload, showInFolder, pickFolder } = useDownloads();
  const downloadSearchRef = useRef<HTMLInputElement | null>(null);
  const [downloadSearchQuery, setDownloadSearchQuery] = useState("");
  const filteredDownloadItems = downloadSearchQuery.trim()
    ? downloadItems.filter((d) => d.filename.toLowerCase().includes(downloadSearchQuery.trim().toLowerCase()))
    : downloadItems;
  const { color: accentColor, setColor: setAccentColor } = useAccentColor();
  const { scheme, setScheme } = useColorScheme();
  const { isGuest } = useProfiles();
  const { passwords, add: addPassword, update: updatePassword, remove: removePassword, importFrom: importPasswordsFrom } = usePasswords();
  const { entries: permissionEntries, set: setPermission, remove: removePermission } = useSitePermissions();
  const { settings: privacySettings, update: updatePrivacy } = usePrivacySettings();
  const [extensionsList, setExtensionsList] = useState<{ id: string; name: string; path: string; enabled: boolean }[]>([]);
  const [extensionError, setExtensionError] = useState<string | null>(null);
  useEffect(() => {
    window.browserAPI?.extensions.list().then(setExtensionsList);
  }, []);
  const [nightModeOn, setNightModeOn] = useState(false);
  useEffect(() => {
    if (nightModeTabId) window.browserAPI?.tabs.isNightMode(nightModeTabId).then(setNightModeOn);
  }, [nightModeTabId]);
  const [permissionDomainInput, setPermissionDomainInput] = useState("");
  const [permissionDomainConfirmed, setPermissionDomainConfirmed] = useState<string | null>(null);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [permissionShowCount, setPermissionShowCount] = useState(10);
  const filteredPermissionEntries = permissionEntries.filter((e) => e.domain.toLowerCase().includes(permissionSearch.trim().toLowerCase()));
  const visiblePermissionEntries = filteredPermissionEntries.slice(0, permissionShowCount);
  const [passwordSearch, setPasswordSearch] = useState("");
  const filteredPasswords = passwordSearch.trim()
    ? passwords.filter((p) => {
        const q = passwordSearch.trim().toLowerCase();
        return p.url.toLowerCase().includes(q) || p.username.toLowerCase().includes(q);
      })
    : passwords;

  const [defaultBrowserRequested, setDefaultBrowserRequested] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: "", url: "" });
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteFavoriteId, setConfirmDeleteFavoriteId] = useState<string | null>(null);
  const [confirmDeleteDownloadId, setConfirmDeleteDownloadId] = useState<string | null>(null);

  // The Edit/Download/Settings toolbar buttons jump straight to their
  // section instead of always landing at the top — the anchor is set right
  // before navigating here (see goToSettings in routes/index.tsx) and
  // either consumed on mount or, if this page is already open, picked up
  // live via the subscription (a mount-only effect never re-fires for a
  // component that was already mounted).
  useEffect(() => {
    const scrollTo = (id: string) => {
      // "downloads:search" is the same downloads section, just also
      // focusing the search field below once scrolled there — see
      // DownloadsPopoverContent.tsx's search icon (openSettingsSearch)
      // and goToSettings's handling of it in routes/index.tsx.
      const targetId = id === "downloads:search" ? "downloads" : id;
      requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (id === "downloads:search") setTimeout(() => downloadSearchRef.current?.focus(), 300);
      });
    };
    const anchor = takePendingSettingsAnchor();
    if (anchor) scrollTo(anchor);
    return subscribeSettingsAnchor(scrollTo);
  }, []);

  const api = typeof window !== "undefined" ? window.browserAPI : undefined;

  // "Continue where you left off" — off by default (see session-store.ts).
  const [restoreOnStart, setRestoreOnStartState] = useState(false);
  useEffect(() => {
    api?.session.getRestoreOnStart().then(setRestoreOnStartState);
  }, [api]);
  const toggleRestoreOnStart = () => {
    const next = !restoreOnStart;
    setRestoreOnStartState(next);
    api?.session.setRestoreOnStart(next);
  };

  const openEdit = (id: string, label: string, url: string) => {
    setEditId(id);
    setEditForm({ label, url });
    setEditOpen(true);
  };
  const openAdd = () => {
    setEditId(null);
    setEditForm({ label: "", url: "" });
    setEditOpen(true);
  };
  const saveEdit = () => {
    const label = editForm.label.trim() || editForm.url;
    const url = editForm.url.trim();
    if (!url) return;
    if (editId) updateFavorite(editId, { label, url });
    else addFavorite(label, url);
    setEditOpen(false);
  };

  const [importPicker, setImportPicker] = useState<{ browser: "chrome" | "edge"; profiles: { id: string; name: string }[]; kind: "favorites" | "passwords" } | null>(null);

  const startImport = async (browser: "chrome" | "edge") => {
    setImportResult(null);
    const profiles = await api?.importer.listProfiles(browser);
    if (!profiles || profiles.length === 0) {
      setImportResult(`Couldn't find ${browser === "chrome" ? "Chrome" : "Edge"} on this computer.`);
      return;
    }
    if (profiles.length === 1 && profiles[0]) {
      runImport(browser, profiles[0].id);
      return;
    }
    setImportPicker({ browser, profiles, kind: "favorites" });
  };

  const runImport = async (browser: "chrome" | "edge", profileId: string) => {
    setImportPicker(null);
    setImportResult("Importing…");
    const imported = await api?.importer.bookmarks(browser, profileId);
    if (!imported) {
      setImportResult(`Couldn't find that profile's bookmarks.`);
      return;
    }
    const existingUrls = new Set(favorites.map((f) => f.url));
    const fresh = imported.filter((f) => !existingUrls.has(f.url));
    addManyFavorites(fresh);
    setImportResult(`Imported ${fresh.length} favorite${fresh.length === 1 ? "" : "s"}${imported.length !== fresh.length ? ` (${imported.length - fresh.length} already had a match)` : ""}.`);
  };

  const [passwordImportResult, setPasswordImportResult] = useState<string | null>(null);

  const startPasswordImport = async (browser: "chrome" | "edge") => {
    setPasswordImportResult(null);
    const profiles = await api?.importer.listProfiles(browser);
    if (!profiles || profiles.length === 0) {
      setPasswordImportResult(`Couldn't find ${browser === "chrome" ? "Chrome" : "Edge"} on this computer.`);
      return;
    }
    if (profiles.length === 1 && profiles[0]) {
      runPasswordImport(browser, profiles[0].id);
      return;
    }
    setImportPicker({ browser, profiles, kind: "passwords" });
  };

  const runPasswordImport = async (browser: "chrome" | "edge", profileId: string) => {
    setImportPicker(null);
    setPasswordImportResult("Importing…");
    const result = await importPasswordsFrom?.(browser, profileId);
    if (!result || result.error) {
      setPasswordImportResult(result?.error ?? "Something went wrong.");
      return;
    }
    setPasswordImportResult(
      `Imported ${result.imported} password${result.imported === 1 ? "" : "s"}${result.skipped > 0 ? ` (${result.skipped} already saved)` : ""}.`,
    );
  };

  // Password entry add/edit dialog — mirrors the favorites edit dialog
  // below (editId/editForm/editOpen), kept separate since the shape (an
  // extra password field) differs.
  const [pwEditId, setPwEditId] = useState<string | null>(null);
  const [pwEditForm, setPwEditForm] = useState({ url: "", username: "", password: "" });
  const [pwEditOpen, setPwEditOpen] = useState(false);
  const [pwRevealedId, setPwRevealedId] = useState<string | null>(null);
  const [confirmDeletePasswordId, setConfirmDeletePasswordId] = useState<string | null>(null);

  const openAddPassword = () => {
    setPwEditId(null);
    setPwEditForm({ url: "", username: "", password: "" });
    setPwEditOpen(true);
  };
  const openEditPassword = (id: string, url: string, username: string) => {
    setPwEditId(id);
    setPwEditForm({ url, username, password: "" }); // password left blank — "keep existing" unless retyped, see savePasswordEdit
    setPwEditOpen(true);
  };
  const savePasswordEdit = () => {
    const url = pwEditForm.url.trim();
    const username = pwEditForm.username.trim();
    if (!url) return;
    if (pwEditId) updatePassword(pwEditId, url, username, pwEditForm.password || undefined);
    else addPassword(url, username, pwEditForm.password);
    setPwEditOpen(false);
  };

  return (
    <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
      <PageScrollbar scrollRef={scrollRef} />
      {/* Page zoom here is now the same real, interactive Ctrl+wheel/pinch
          zoom as on browsed tabs (see main.ts's mainWindow zoom-changed
          listener) — this used to be a CSS `zoom:` fake tied to the
          zoomLevel setting value, which would have double-scaled once the
          real zoom took over. The "Default Page Zoom" setting below still
          exists, but only as the default new tabs start at. */}
      <div className="mx-auto max-w-xl px-8 py-8">
        <h1 className="mb-8 text-xl font-semibold text-foreground">Settings</h1>

        {/* 1 — Search engine + default browser */}
        <Section id="search" title="Search & default browser">
          <SettingsCard>
            <CardSection>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <Search className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Search engine</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Used for anything typed into the address bar that isn't a URL</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {SEARCH_ENGINES.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setEngine(e.id)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-medium text-foreground transition-all duration-150 ${
                      engine === e.id ? "border-[var(--brand)] bg-[var(--brand)]/10 shadow-sm" : "border-border hover:bg-muted"
                    }`}
                  >
                    <img src={`https://icons.duckduckgo.com/ip3/${e.domain}.ico`} alt="" className="h-6 w-6 shrink-0 rounded-md object-contain" />
                    <span className="truncate">{e.label}</span>
                  </button>
                ))}
              </div>
            </CardSection>
            <Divider />
            <CardSection>
              <Row
                icon={Globe}
                label="Default browser"
                description={defaultBrowserRequested ? "Finish this in the Windows settings window that opened" : "Open links from other apps in QueckSilver Search"}
              >
                <Button
                  size="sm"
                  className="rounded-full text-white shadow hover:opacity-90"
                  style={{ background: "var(--brand)" }}
                  onClick={async () => {
                    // Windows requires the person to actually confirm this
                    // themselves in its own Settings window — Electron can
                    // only offer to register as a candidate, it can't force
                    // the switch. This message is just a transient hint
                    // right after clicking, not a real status — it clears
                    // itself after a bit either way, so revisiting Settings
                    // later always shows the plain, neutral description
                    // again rather than getting stuck.
                    setDefaultBrowserRequested(true);
                    setTimeout(() => setDefaultBrowserRequested(false), 15000);
                    await api?.system.setDefaultBrowser();
                  }}
                >
                  Set as default
                </Button>
              </Row>
            </CardSection>
            <Divider />
            <CardSection>
              <Row icon={RotateCw} label="On startup" description={restoreOnStart ? "Continue where you left off" : "Open a fresh Start page"}>
                <button
                  onClick={toggleRestoreOnStart}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    restoreOnStart ? "bg-[var(--brand)]/10 text-[var(--brand)]" : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {restoreOnStart ? "Restore last session" : "Fresh Start page"}
                </button>
              </Row>
            </CardSection>
          </SettingsCard>
        </Section>

        {/* 2 — Downloads + edit favorites */}
        <Section id="downloads" title="Downloads">
          <SettingsCard className="mb-3">
            <CardSection>
              <Row icon={FolderOpen} label="Save location" description={downloadFolder || "…"}>
                <Button size="sm" variant="outline" className="rounded-full" onClick={pickFolder}>
                  Change
                </Button>
              </Row>
            </CardSection>
          </SettingsCard>
          {downloadItems.length > 0 && (
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={downloadSearchRef}
                value={downloadSearchQuery}
                onChange={(e) => setDownloadSearchQuery(e.target.value)}
                placeholder="Search downloads"
                className="rounded-full pl-10"
              />
            </div>
          )}
          {downloadItems.length === 0 ? (
            <SettingsCard>
              <CardSection className="py-6 text-center text-sm text-muted-foreground">No downloads yet.</CardSection>
            </SettingsCard>
          ) : filteredDownloadItems.length === 0 ? (
            <SettingsCard>
              <CardSection className="py-6 text-center text-sm text-muted-foreground">No downloads match "{downloadSearchQuery}".</CardSection>
            </SettingsCard>
          ) : (
            <SettingsCard>
              {filteredDownloadItems.map((d, i) => (
                <div key={d.id}>
                  {i > 0 && <Divider />}
                  <CardSection className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                      <Download className={`h-4 w-4 ${d.state === "progressing" ? "animate-pulse text-green-600" : "text-muted-foreground"}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <button onClick={() => openDownload(d.path)} className="block w-full truncate text-left text-sm font-medium text-foreground hover:underline">
                        {d.filename}
                      </button>
                      {d.state === "progressing" ? (
                        <div className="mt-1">
                          <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-green-600 transition-all"
                              style={{ width: `${d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : 0}%` }}
                            />
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(d.receivedBytes)} of {formatBytes(d.totalBytes)}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">{d.state === "completed" ? formatBytes(d.totalBytes) : d.state}</p>
                      )}
                    </div>
                    <button onClick={() => showInFolder(d.path)} className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                      <FolderOpen className="h-4 w-4" />
                    </button>
                    <button onClick={() => setConfirmDeleteDownloadId(d.id)} className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </CardSection>
                </div>
              ))}
            </SettingsCard>
          )}
        </Section>

        <Section id="favorites" title="Favorites">
          {isGuest ? (
            <SettingsCard>
              <CardSection className="py-6 text-center text-sm text-muted-foreground">Sign in to use favorites.</CardSection>
            </SettingsCard>
          ) : favorites.length === 0 ? (
            <SettingsCard>
              <CardSection className="py-6 text-center text-sm text-muted-foreground">No favorites yet.</CardSection>
            </SettingsCard>
          ) : (
            <SettingsCard>
              {favorites.map((f, i) => (
                <div key={f.id}>
                  {i > 0 && <Divider />}
                  <CardSection className="flex items-center gap-3">
                    <FavIcon url={f.url} label={f.label} size="h-5 w-5" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{f.label}</span>
                    <span className="hidden max-w-[160px] truncate text-xs text-muted-foreground sm:block">{f.url}</span>
                    <button onClick={() => openEdit(f.id, f.label, f.url)} title="Edit" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button onClick={() => setConfirmDeleteFavoriteId(f.id)} title="Delete" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </CardSection>
                </div>
              ))}
            </SettingsCard>
          )}
          {/* Below the list, not above it — the list is the main content,
              adding is the secondary action. */}
          {!isGuest && (
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHeaderFavoritesBarVisible(!headerFavoritesBarVisible)}
                title={headerFavoritesBarVisible ? "Hide the favorites bar in the header" : "Show the favorites bar in the header"}
                className="gap-1.5 rounded-full"
              >
                {headerFavoritesBarVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {headerFavoritesBarVisible ? "Bar shown" : "Bar hidden"}
              </Button>
              <Button size="sm" variant="outline" onClick={openAdd} className="gap-1.5 rounded-full">
                <Plus className="h-3.5 w-3.5" />
                Add favorite
              </Button>
            </div>
          )}
        </Section>

        <Section id="passwords" title="Passwords">
          {isGuest ? (
            <SettingsCard>
              <CardSection className="py-6 text-center text-sm text-muted-foreground">Sign in to use the password manager.</CardSection>
            </SettingsCard>
          ) : passwords.length === 0 ? (
            <SettingsCard>
              <CardSection className="py-6 text-center text-sm text-muted-foreground">No saved passwords yet.</CardSection>
            </SettingsCard>
          ) : (
            <>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={passwordSearch}
                  onChange={(e) => setPasswordSearch(e.target.value)}
                  placeholder="Search passwords"
                  className="rounded-full pl-10"
                />
              </div>
              {filteredPasswords.length === 0 ? (
                <SettingsCard>
                  <CardSection className="py-6 text-center text-sm text-muted-foreground">No passwords match "{passwordSearch}".</CardSection>
                </SettingsCard>
              ) : (
                <SettingsCard>
                  {filteredPasswords.map((p, i) => (
                    <div key={p.id}>
                      {i > 0 && <Divider />}
                      <CardSection className="flex items-center gap-3">
                        <FavIcon url={p.url} label={p.url} size="h-5 w-5" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{p.url}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.username || "No username"} · {pwRevealedId === p.id ? p.password : "••••••••"}
                          </span>
                        </span>
                        <button
                          onClick={() => setPwRevealedId(pwRevealedId === p.id ? null : p.id)}
                          title={pwRevealedId === p.id ? "Hide" : "Reveal"}
                          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {pwRevealedId === p.id ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                        <button onClick={() => openEditPassword(p.id, p.url, p.username)} title="Edit" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button onClick={() => setConfirmDeletePasswordId(p.id)} title="Delete" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </CardSection>
                    </div>
                  ))}
                </SettingsCard>
              )}
            </>
          )}
          {!isGuest && (
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant="outline" onClick={openAddPassword} className="gap-1.5 rounded-full">
                <Plus className="h-3.5 w-3.5" />
                Add password
              </Button>
            </div>
          )}
        </Section>

        {/* 2.5 — Site permissions */}
        <Section id="permissions" title="Site permissions">
          <SettingsCard>
            <CardSection>
              <p className="text-sm font-medium text-foreground">Set a permission</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Type a site's address, confirm it, then allow or block what it can access.</p>
              <div className="mt-3 flex items-center gap-2">
                <Input
                  value={permissionDomainInput}
                  onChange={(e) => setPermissionDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && permissionDomainInput.trim()) setPermissionDomainConfirmed(cleanDomain(permissionDomainInput));
                  }}
                  placeholder="example.com"
                  className="flex-1"
                />
                {permissionDomainInput.trim() && <FavIcon url={`https://${cleanDomain(permissionDomainInput)}`} label={cleanDomain(permissionDomainInput)} size="h-5 w-5" />}
                <button
                  disabled={!permissionDomainInput.trim()}
                  onClick={() => setPermissionDomainConfirmed(cleanDomain(permissionDomainInput))}
                  aria-label="Confirm site"
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-30 ${
                    permissionDomainConfirmed === cleanDomain(permissionDomainInput) && permissionDomainInput.trim()
                      ? "bg-[var(--brand)] text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
              {permissionDomainConfirmed && permissionDomainConfirmed === cleanDomain(permissionDomainInput) && (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  {(["camera", "microphone", "notifications", "autoDownloads"] as const).map((kind) => {
                    const existing = permissionEntries.find((e) => e.domain === permissionDomainConfirmed);
                    const state = existing?.[kind] ?? "block";
                    return (
                      <div key={kind} className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm text-foreground">
                          {PERMISSION_ICONS[kind]}
                          {PERMISSION_LABELS[kind]}
                        </span>
                        <button
                          onClick={() => setPermission(permissionDomainConfirmed, kind, state === "allow" ? "block" : "allow")}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            state === "allow" ? "bg-[var(--brand)]/10 text-[var(--brand)]" : "bg-muted text-muted-foreground hover:bg-muted/70"
                          }`}
                        >
                          {state === "allow" ? "Allowed" : "Blocked"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardSection>
          </SettingsCard>

          {permissionEntries.length > 0 && (
            <>
              <div className="relative mb-3 mt-3">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={permissionSearch}
                  onChange={(e) => setPermissionSearch(e.target.value)}
                  placeholder="Search sites"
                  className="rounded-full pl-10"
                />
              </div>
              <SettingsCard>
                {visiblePermissionEntries.map((entry, i) => (
                  <div key={entry.domain}>
                    {i > 0 && <Divider />}
                    <CardSection className="flex items-center gap-3">
                      <FavIcon url={`https://${entry.domain}`} label={entry.domain} size="h-5 w-5" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{entry.domain}</span>
                      {(["camera", "microphone", "notifications", "autoDownloads"] as const).map((kind) => (
                        <button
                          key={kind}
                          title={PERMISSION_LABELS[kind]}
                          onClick={() => setPermission(entry.domain, kind, entry[kind] === "allow" ? "block" : "allow")}
                          className={`shrink-0 rounded-full p-1.5 transition-colors ${entry[kind] === "allow" ? "text-[var(--brand)]" : "text-muted-foreground line-through"}`}
                        >
                          {PERMISSION_ICONS[kind]}
                        </button>
                      ))}
                      <button onClick={() => removePermission(entry.domain)} title="Forget this site" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </CardSection>
                  </div>
                ))}
              </SettingsCard>
              {filteredPermissionEntries.length > permissionShowCount && (
                <div className="mt-2 flex justify-center">
                  <button onClick={() => setPermissionShowCount((n) => n + 10)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                    Show more ({filteredPermissionEntries.length - permissionShowCount} more)
                  </button>
                </div>
              )}
            </>
          )}
        </Section>

        <Section id="import" title="Import">
          <SettingsCard>
            <CardSection>
              <Row icon={Star} label="Favorites" description={isGuest ? "Sign in to import favorites" : "From Chrome or Edge on this computer"}>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={isGuest} onClick={() => startImport("chrome")} className="gap-1.5 rounded-full">
                    <img src="https://icons.duckduckgo.com/ip3/google.com.ico" alt="" className="h-4 w-4 object-contain" />
                    Chrome
                  </Button>
                  <Button size="sm" variant="outline" disabled={isGuest} onClick={() => startImport("edge")} className="gap-1.5 rounded-full">
                    <img src="https://icons.duckduckgo.com/ip3/microsoft.com.ico" alt="" className="h-4 w-4 object-contain" />
                    Edge
                  </Button>
                </div>
              </Row>
              {importResult && <ImportProgress text={importResult} inProgress={importResult === "Importing…"} />}
            </CardSection>
            <Divider />
            <CardSection>
              <Row icon={KeyRound} label="Passwords" description={isGuest ? "Sign in to import passwords" : "From Chrome or Edge on this computer"}>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={isGuest} onClick={() => startPasswordImport("chrome")} className="gap-1.5 rounded-full">
                    <img src="https://icons.duckduckgo.com/ip3/google.com.ico" alt="" className="h-4 w-4 object-contain" />
                    Chrome
                  </Button>
                  <Button size="sm" variant="outline" disabled={isGuest} onClick={() => startPasswordImport("edge")} className="gap-1.5 rounded-full">
                    <img src="https://icons.duckduckgo.com/ip3/microsoft.com.ico" alt="" className="h-4 w-4 object-contain" />
                    Edge
                  </Button>
                </div>
              </Row>
              {passwordImportResult && <ImportProgress text={passwordImportResult} inProgress={passwordImportResult === "Importing…"} />}
            </CardSection>
          </SettingsCard>
        </Section>

        {/* 4 — Theme */}
        <Section id="theme" title="Theme">
          <div className="mb-3 flex gap-2">
            {([
              { value: "system" as ColorScheme, label: "System", icon: Monitor },
              { value: "light" as ColorScheme, label: "Light", icon: Sun },
              { value: "dark" as ColorScheme, label: "Dark", icon: Moon },
            ]).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setScheme(value)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-all ${
                  scheme === value ? "border-[var(--brand)] bg-[var(--brand)]/10 text-foreground shadow-sm" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <SettingsCard>
            <CardSection>
              <div className="grid grid-cols-8 gap-2">
                {THEME_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setAccentColor(c)}
                    aria-label={c}
                    className="flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-black/10 transition-transform hover:scale-110"
                    style={{ background: c }}
                  >
                    {c === accentColor && <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </CardSection>
          </SettingsCard>

          <button
            onClick={() => setToolbarStyleOpen((v) => !v)}
            className="mt-3 flex w-full items-center justify-between rounded-2xl border border-border/60 bg-card px-4 py-3 text-left shadow-sm"
          >
            <div>
              <p className="text-sm font-medium text-foreground">Toolbar style</p>
              <p className="mt-0.5 text-xs text-muted-foreground">How the Edit/Settings/Downloads/Split icons look</p>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${toolbarStyleOpen ? "rotate-180" : ""}`} />
          </button>

          {toolbarStyleOpen && (
            <div className="mt-2 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
              {TOOLBAR_STYLES.map((opt) => (
                <div key={opt.id} className="flex items-center gap-4 px-4 py-3.5">
                  <span className="w-36 shrink-0 text-xs font-medium text-muted-foreground">{opt.label}</span>
                  <div className="flex flex-1 items-center overflow-x-auto py-1">
                    <ToolbarActionIcons style={opt.id} actions={previewActions} onOpenDownloads={() => {}} draggedId={null} onDragStart={() => {}} onDropOn={() => {}} onDragEnd={() => {}} />
                  </div>
                  <Button
                    size="sm"
                    variant={toolbarStyle === opt.id ? "outline" : "default"}
                    disabled={toolbarStyle === opt.id}
                    onClick={() => setToolbarStyle(opt.id)}
                    className="shrink-0 rounded-full"
                    style={toolbarStyle === opt.id ? undefined : { background: "var(--brand)", color: "white" }}
                  >
                    {toolbarStyle === opt.id ? "Active" : "Set"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 5 — Zoom, with a live preview right here (same pattern as the
            real Settings.tsx's font-size preview) so the effect is
            actually visible immediately, not just a number changing. */}
        <Section id="zoom" title="Zoom">
          <SettingsCard>
            <CardSection>
              <Row icon={SettingsIcon} label="Default page zoom" description="Starting zoom for newly opened tabs. Ctrl+scroll/pinch on any page always overrides it.">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setZoomLevel(Math.max(50, zoomLevel - 10))}
                    aria-label="Zoom out"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="w-12 text-center text-sm font-medium text-foreground">{zoomLevel}%</span>
                  <button
                    onClick={() => setZoomLevel(Math.min(200, zoomLevel + 10))}
                    aria-label="Zoom in"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </Row>
            </CardSection>
          </SettingsCard>
        </Section>

        {/* Night mode */}
        <Section id="nightmode" title="Night mode">
          <SettingsCard>
            <CardSection>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <Moon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Night mode</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {nightModeTabId ? "Inverts colors on the page you were last browsing" : "Open a real page first, there's nothing to invert here in Settings"}
                  </p>
                </div>
                <button
                  disabled={!nightModeTabId}
                  onClick={async () => {
                    if (!nightModeTabId) return;
                    const next = await window.browserAPI?.tabs.toggleNightModeFor(nightModeTabId);
                    setNightModeOn(Boolean(next));
                  }}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                    nightModeOn ? "bg-[var(--brand)]/10 text-[var(--brand)]" : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {nightModeOn ? "On" : "Off"}
                </button>
              </div>
            </CardSection>
          </SettingsCard>
        </Section>

        {/* Privacy & Security */}
        <Section id="privacy" title="Privacy & Security">
          <SettingsCard>
            <CardSection>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Remove tracking parameters</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Strips utm_*, fbclid, gclid and similar tracking codes from links before they load</p>
                </div>
                <Switch checked={privacySettings.removeTrackingParams} onCheckedChange={(v) => updatePrivacy({ removeTrackingParams: v })} />
              </div>
            </CardSection>
            <Divider />
            <CardSection>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Phishing & malware protection</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Warns before loading sites reported as dangerous (Google Safe Browsing)</p>
                </div>
                <Switch checked={privacySettings.phishingProtection} onCheckedChange={(v) => updatePrivacy({ phishingProtection: v })} />
              </div>
            </CardSection>
            <Divider />
            <CardSection>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">HTTPS-Only mode</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Never silently falls back to an unencrypted connection, asks first</p>
                </div>
                <Switch checked={privacySettings.httpsOnly} onCheckedChange={(v) => updatePrivacy({ httpsOnly: v })} />
              </div>
            </CardSection>
            <Divider />
            <CardSection>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">DNS-over-HTTPS</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Encrypts DNS lookups so your network provider can't see which sites you visit. Needs a restart to take effect.</p>
                </div>
                <select
                  value={privacySettings.dohProvider}
                  onChange={(e) => updatePrivacy({ dohProvider: e.target.value as DohProvider })}
                  className="shrink-0 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground"
                >
                  <option value="off">Off</option>
                  <option value="cloudflare">Cloudflare</option>
                  <option value="quad9">Quad9</option>
                </select>
              </div>
            </CardSection>
            <Divider />
            <CardSection>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Panic shortcut</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Instantly closes every window and clears in-memory session data, works even when the app isn't focused</p>
                </div>
                <PanicShortcutRecorder value={privacySettings.panicShortcut} onChange={(v) => updatePrivacy({ panicShortcut: v })} />
              </div>
            </CardSection>
            <Divider />
            <CardSection>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <TorOnionLogo className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Tor binary path</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    Leave blank to auto-detect. Get the official binary from{" "}
                    <span className="underline">torproject.org/download/tor</span>, it isn't bundled with the app.
                  </p>
                  <Input
                    value={privacySettings.torBinaryPath}
                    onChange={(e) => updatePrivacy({ torBinaryPath: e.target.value })}
                    placeholder="/path/to/tor"
                    className="mt-2"
                  />
                </div>
              </div>
            </CardSection>
            <Divider />
            <CardSection>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Tor security level</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Safest disables JavaScript entirely, many sites won't work, by design</p>
                </div>
                <select
                  value={privacySettings.torSecurityLevel}
                  onChange={(e) => updatePrivacy({ torSecurityLevel: e.target.value as "standard" | "safer" | "safest" })}
                  className="shrink-0 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground"
                >
                  <option value="standard">Standard</option>
                  <option value="safer">Safer</option>
                  <option value="safest">Safest</option>
                </select>
              </div>
            </CardSection>
          </SettingsCard>
        </Section>

        {/* Extensions */}
        <Section id="extensions" title="Extensions">
          <SettingsCard>
            <CardSection>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Load unpacked extension</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Pick a folder containing a manifest.json, no Chrome Web Store support, extensions must already be unpacked on disk</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 rounded-full"
                  onClick={async () => {
                    const result = await window.browserAPI?.extensions.addFromFolder();
                    if (result && "error" in result) {
                      setExtensionError(result.error);
                    } else {
                      setExtensionError(null);
                      window.browserAPI?.extensions.list().then(setExtensionsList);
                    }
                  }}
                >
                  Choose folder
                </Button>
              </div>
              {extensionError && <p className="mt-2 text-xs text-destructive">{extensionError}</p>}
            </CardSection>
          </SettingsCard>

          {extensionsList.length > 0 && (
            <SettingsCard className="mt-3">
              {extensionsList.map((ext, i) => (
                <div key={ext.id}>
                  {i > 0 && <Divider />}
                  <CardSection className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{ext.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{ext.path}</span>
                    </span>
                    <button
                      onClick={async () => {
                        await window.browserAPI?.extensions.setEnabled(ext.id, !ext.enabled);
                        window.browserAPI?.extensions.list().then(setExtensionsList);
                      }}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        ext.enabled ? "bg-[var(--brand)]/10 text-[var(--brand)]" : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      {ext.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      onClick={async () => {
                        await window.browserAPI?.extensions.remove(ext.id);
                        window.browserAPI?.extensions.list().then(setExtensionsList);
                      }}
                      title="Remove"
                      className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </CardSection>
                </div>
              ))}
            </SettingsCard>
          )}
        </Section>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Edit favorite" : "Add favorite"}</DialogTitle>
            <DialogDescription>Name and address of this favorite.</DialogDescription>
          </DialogHeader>
          {/* <form onSubmit> makes Enter in either field submit natively —
              same pattern as the home-page bookmark dialog in routes/index.tsx. */}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="fav-edit-label">Name</Label>
              <Input id="fav-edit-label" value={editForm.label} onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fav-edit-url">URL</Label>
              <Input id="fav-edit-url" value={editForm.url} onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)} className="rounded-full">Cancel</Button>
              <Button type="submit" className="rounded-full text-white shadow hover:opacity-90" style={{ background: "var(--brand)" }}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteFavoriteId !== null}
        title="Delete favorite"
        body="This favorite will be removed from your bar."
        onCancel={() => setConfirmDeleteFavoriteId(null)}
        onConfirm={() => {
          if (confirmDeleteFavoriteId) removeFavorite(confirmDeleteFavoriteId);
          setConfirmDeleteFavoriteId(null);
        }}
      />

      <Dialog open={pwEditOpen} onOpenChange={setPwEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pwEditId ? "Edit password" : "Add password"}</DialogTitle>
            <DialogDescription>Saved passwords are encrypted on this device.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              savePasswordEdit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="pw-edit-url">Website</Label>
              <Input id="pw-edit-url" value={pwEditForm.url} onChange={(e) => setPwEditForm((f) => ({ ...f, url: e.target.value }))} placeholder="example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-edit-username">Username</Label>
              <Input id="pw-edit-username" value={pwEditForm.username} onChange={(e) => setPwEditForm((f) => ({ ...f, username: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-edit-password">Password{pwEditId ? " (leave blank to keep the current one)" : ""}</Label>
              <Input id="pw-edit-password" type="password" value={pwEditForm.password} onChange={(e) => setPwEditForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPwEditOpen(false)} className="rounded-full">Cancel</Button>
              <Button type="submit" className="rounded-full text-white shadow hover:opacity-90" style={{ background: "var(--brand)" }}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDeletePasswordId !== null}
        title="Delete password"
        body="This saved password will be permanently removed."
        onCancel={() => setConfirmDeletePasswordId(null)}
        onConfirm={() => {
          if (confirmDeletePasswordId) removePassword(confirmDeletePasswordId);
          setConfirmDeletePasswordId(null);
        }}
      />

      <ConfirmDialog
        open={confirmDeleteDownloadId !== null}
        title="Delete download"
        body="This will remove it from your downloads list (the file itself isn't touched)."
        onCancel={() => setConfirmDeleteDownloadId(null)}
        onConfirm={() => {
          if (confirmDeleteDownloadId) removeDownload(confirmDeleteDownloadId);
          setConfirmDeleteDownloadId(null);
        }}
      />

      {/* Import profile picker — real panels per profile (not a plain
          list), each with an avatar placeholder, matching how a proper
          "pick your profile" UI actually looks rather than a bare menu. */}
      {importPicker && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={() => setImportPicker(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-1 text-base font-semibold text-foreground">Which profile?</p>
            <p className="mb-4 text-sm text-muted-foreground">{importPicker.browser === "chrome" ? "Chrome" : "Edge"} has more than one profile on this computer.</p>
            <div className="mb-2 grid grid-cols-2 gap-2.5">
              {importPicker.profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => (importPicker.kind === "passwords" ? runPasswordImport(importPicker.browser, p.id) : runImport(importPicker.browser, p.id))}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-background px-3 py-4 text-center transition-colors hover:border-[var(--brand)] hover:bg-muted"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <User className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <span className="line-clamp-2 text-sm font-medium leading-tight text-foreground">{p.name}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setImportPicker(null)} className="mt-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

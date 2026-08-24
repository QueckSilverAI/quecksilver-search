// Content-only port of the old "click download icon → navigate to
// Settings → Downloads" behavior in routes/index.tsx, now a proper
// Edge-style flyout hosted in the native overlay window ("belowRight"
// placement, same as the profile popup) instead of leaving the current
// page. index.tsx also auto-opens this the moment a NEW download starts
// (see its activeDownloadCount effect), so live progress shows up without
// needing a click at all.
import { useEffect, useRef, useState } from "react";
import { Download, Folder, MoreHorizontal, Search, X } from "lucide-react";
import type { DownloadsOverlayAction, DownloadsOverlayPayload } from "@/overlay/types";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DownloadsPopoverContent({
  payload,
  onAction,
  onNotify,
}: {
  payload: DownloadsOverlayPayload;
  onAction: (action: DownloadsOverlayAction) => void;
  onNotify: (action: DownloadsOverlayAction) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const downloadListRef = useRef<HTMLDivElement | null>(null);
  // Everything about "removed" lives ENTIRELY here now — plain local
  // state, one setTimeout, nothing else. Earlier versions of this tried
  // tracking it in index.tsx instead (so it would survive an actual
  // close+reopen more "properly"), threading it through a payload field,
  // a ref-based cache for items already gone from the real list, and
  // careful ordering across several effects — repeatedly broken by that
  // same complexity in different ways each round. This component's
  // content never actually unmounts just from the popup being closed and
  // reopened (see FolderContentsContent.tsx's identical note) — a plain
  // setTimeout started here keeps running regardless, correctly finishing
  // its 5s and firing the real removal even if closed/reopened meanwhile.
  // Simple, self-contained, one thing doing one job.
  const [pendingRemoveIds, setPendingRemoveIds] = useState<Set<string>>(new Set());

  // Same reasoning as FolderContentsContent.tsx's identical effect — this
  // overlay window's content never unmounts just from being closed and
  // reopened, so the "..." menu's own open/closed state needs an
  // explicit reset on every fresh reshow, or a stale-open menu could
  // persist across an unrelated close+reopen.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setMenuOpen(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  function remove(id: string) {
    setPendingRemoveIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      onNotify({ type: "remove", id });
      setPendingRemoveIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 5000);
  }

  return (
    <div className="w-[380px] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <h2 className="text-lg font-bold leading-none tracking-tight text-foreground">Downloads</h2>
        <div className="relative flex items-center gap-1">
          <button
            onClick={() => onAction({ type: "openFolder" })}
            title="Open downloads folder"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Folder className="h-[18px] w-[18px]" />
          </button>
          <button
            title="Search downloads"
            onClick={() => onAction({ type: "openSettingsSearch" })}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="More options"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="h-[18px] w-[18px]" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-10 w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
              <button
                onClick={() => onAction({ type: "openSettings" })}
                className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted"
              >
                See all downloads
              </button>
            </div>
          )}
        </div>
      </div>

      {/* No "Show more" — the whole history scrolls, this just caps how
          tall the flyout itself gets (see reportSize in
          overlay-window.ts: the native window is sized to match this
          div, so an unbounded list would grow the window forever instead
          of scrolling). custom-scrollbar (styles.css) is a native
          scrollbar restyled via ::-webkit-scrollbar — see that class's
          own comment. */}
      <div ref={downloadListRef} className="custom-scrollbar max-h-[480px] overflow-y-auto border-t border-border">
        {payload.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">No downloads yet.</p>
        ) : (
          payload.items.map((d) => {
            const removed = pendingRemoveIds.has(d.id);
            return (
              <div key={d.id} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
                  <Download className={`h-4 w-4 ${removed ? "text-muted-foreground/50" : d.state === "progressing" ? "animate-pulse text-green-600" : "text-muted-foreground"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  {removed ? (
                    <>
                      <p className="truncate text-[14px] font-medium leading-tight text-muted-foreground/60 line-through">{d.filename}</p>
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground/60">Removed</p>
                    </>
                  ) : (
                    <>
                      <p className="truncate text-[14px] font-medium leading-tight text-foreground">{d.filename}</p>
                      {d.state === "progressing" ? (
                        <div className="mt-1.5">
                          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-green-600 transition-all"
                              style={{ width: `${d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : 0}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {formatBytes(d.receivedBytes)} of {formatBytes(d.totalBytes)}
                          </p>
                        </div>
                      ) : d.state === "completed" ? (
                        <button onClick={() => onAction({ type: "open", path: d.path })} className="mt-0.5 text-[12.5px] font-medium text-[var(--brand)] hover:underline">
                          Open file
                        </button>
                      ) : (
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{d.state === "cancelled" ? "Cancelled" : "Failed"}</p>
                      )}
                    </>
                  )}
                </div>
                {!removed && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    {d.state === "completed" && (
                      <button
                        onClick={() => onAction({ type: "showInFolder", path: d.path })}
                        title="Show in folder"
                        className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Folder className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => remove(d.id)}
                      title="Remove from list"
                      className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { CheckCircle2, History, Trash2, XCircle } from "lucide-react";
import type { AuditLogEntry } from "@/hooks/use-browser-api";

// zora-browser-integration-plan.md section 6, "Audit-Log der Tool-Calls
// sichtbar in der Sidebar" — every tool call Zora has made in this
// window, success or failure, so the person can always check what it
// actually did without having to scroll back through the whole
// conversation. Re-fetches from electron/browser-tools.ts's in-memory
// log each time it's opened rather than pushing live updates — this is
// a look-back/audit feature, not something that needs to update while
// closed.
export function ZoraAuditLog() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    window.browserAPI?.zora.getAuditLog().then(setEntries);
  }, [open]);

  return (
    <div className="relative flex items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Recent actions"
        title="Recent actions"
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <History className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-10 flex max-h-80 w-72 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-foreground">Recent actions</span>
            {entries.length > 0 && (
              <button
                onClick={() =>
                  void window.browserAPI?.zora.clearAuditLog().then(() => setEntries([]))
                }
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>
          <div className="thin-scrollbar overflow-y-auto p-1.5">
            {entries.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                Nothing yet this session.
              </p>
            ) : (
              [...entries].reverse().map((e, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                  {e.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-foreground">{e.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{e.text || "—"}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(e.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

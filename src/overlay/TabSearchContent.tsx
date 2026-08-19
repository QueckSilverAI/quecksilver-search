// Content-only port of the old inline tab-search <Dialog> (Ctrl+Shift+A) in
// routes/index.tsx (see BookmarkDialogContent.tsx's header comment for why
// the plain Dialog/DialogContent primitives work unmodified inside a
// "cover"-mode overlay window). Filtering happens entirely client-side
// here — the full tab list is already in the payload, kept fresh via
// index.tsx's overlay.update effect while this is open.
import { useEffect, useRef, useState } from "react";
import { Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { TabSearchOverlayAction, TabSearchOverlayPayload } from "@/overlay/types";

export function TabSearchContent({
  payload,
  onAction,
  onClose,
}: {
  payload: TabSearchOverlayPayload;
  onAction: (action: TabSearchOverlayAction) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The overlay window takes native focus on open (see overlay-window.ts's
  // open()), but that's window-level OS focus, not DOM focus on this
  // specific input — same as every other freshly-opened Dialog needs a
  // nudge for, matching the old inline version's own setTimeout(() =>
  // tabSearchInputRef.current?.focus()) at the Ctrl+Shift+A shortcut site.
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = payload.tabs.filter((t) => !q || t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-0 p-0">
        <div className="border-b border-border p-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search open tabs"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => onAction({ type: "switch", id: t.id })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
            >
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{t.isHome ? "New Tab" : t.isSettings ? "Settings" : t.title || t.url}</div>
                {!t.isHome && !t.isSettings && <div className="truncate text-[11px] text-muted-foreground">{t.url}</div>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="px-2.5 py-4 text-center text-[13px] text-muted-foreground">No matching tabs</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Content-only port of the old inline bookmark-slot <Dialog> in
// routes/index.tsx, now hosted inside a "cover"-mode native overlay window
// (see electron/overlay-window.ts's OverlayAnchor placement docs) instead
// of a DOM dialog fighting the active tab's always-on-top native
// WebContentsView. Because this overlay is a real, separate, transparent
// window sized to cover the owner window's full content area, the
// existing shadcn Dialog/DialogContent primitives "just work" here
// unmodified — their own fixed inset-0 backdrop actually dims the live
// page underneath for the first time, instead of being invisible under
// native content the way it always was inline.
import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BookmarkOverlayAction, BookmarkOverlayPayload } from "@/overlay/types";

export function BookmarkDialogContent({
  payload,
  onAction,
  onClose,
  queryFrequentSites,
}: {
  payload: BookmarkOverlayPayload;
  onAction: (action: BookmarkOverlayAction) => void;
  onClose: () => void;
  queryFrequentSites: (prefix: string) => Promise<{ domain: string; visitCount: number; lastVisit: number }[]>;
}) {
  const [label, setLabel] = useState(payload.label);
  const [url, setUrl] = useState(payload.url);
  const [urlFocused, setUrlFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<{ domain: string; visitCount: number; lastVisit: number }[]>([]);

  // Live URL autocomplete, same debounce as the old inline version — just
  // querying window.overlayAPI.frequentSites (resolved against the OWNER
  // window's id in main.ts) instead of window.browserAPI.frequentSites
  // (this overlay's minimal preload has no access to that main-chrome API
  // at all — see overlay-preload.ts).
  useEffect(() => {
    if (!urlFocused || !url.trim()) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      queryFrequentSites(url).then((results) => {
        if (!cancelled) setSuggestions(results);
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [urlFocused, url, queryFrequentSites]);

  function save() {
    const trimmed = label.trim();
    if (!trimmed) return;
    onAction({ type: "save", slot: payload.slot, label: trimmed, url });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bookmark</DialogTitle>
          <DialogDescription>Name and address of the bookmark.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="bm-label">Name</Label>
            <Input id="bm-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="" autoFocus />
          </div>
          <div className="relative space-y-1.5">
            <Label htmlFor="bm-url">URL</Label>
            <Input
              id="bm-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onFocus={() => setUrlFocused(true)}
              onBlur={() => setTimeout(() => setUrlFocused(false), 150)}
              placeholder=""
            />
            {urlFocused && suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-lg">
                {suggestions.map((s) => (
                  <button
                    key={s.domain}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setUrl(`https://${s.domain}`);
                      setUrlFocused(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted"
                  >
                    <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-foreground">{s.domain}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

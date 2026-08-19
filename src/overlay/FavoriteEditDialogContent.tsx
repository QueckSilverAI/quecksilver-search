// Quick single-item editor for one favorites-bar entry — opened from
// FavoriteContextMenuContent's "Edit" (see index.tsx's handling of the
// "edit" action). Deliberately much simpler than BookmarkDialogContent.tsx
// (the home-page bookmark slots' own editor) — no live URL-suggestion
// autocomplete, since this is editing something that already exists
// rather than picking a fresh destination.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FavoriteEditOverlayAction, FavoriteEditOverlayPayload } from "@/overlay/types";

export function FavoriteEditDialogContent({
  payload,
  onAction,
  onClose,
}: {
  payload: FavoriteEditOverlayPayload;
  onAction: (action: FavoriteEditOverlayAction) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(payload.label);
  const [url, setUrl] = useState(payload.url);

  function save() {
    const trimmedLabel = label.trim();
    if (!trimmedLabel || !url.trim()) return;
    onAction({ type: "save", id: payload.id, label: trimmedLabel, url });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit favorite</DialogTitle>
          <DialogDescription>Name and address of this favorite.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="fav-label">Name</Label>
            <Input id="fav-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fav-url">URL</Label>
            <Input id="fav-url" value={url} onChange={(e) => setUrl(e.target.value)} />
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

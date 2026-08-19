// Just a name prompt — see overlay/types.ts's NewFavoriteFolderOverlayAction
// doc comment for why folder creation and populating it are two separate
// steps rather than one drag gesture.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { NewFavoriteFolderOverlayAction } from "@/overlay/types";

export function NewFavoriteFolderDialogContent({ onAction, onClose }: { onAction: (action: NewFavoriteFolderOverlayAction) => void; onClose: () => void }) {
  const [label, setLabel] = useState("");

  function create() {
    const trimmed = label.trim();
    onAction({ type: "create", label: trimmed || "New folder" });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>Drag favorites onto it afterward to add them.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-folder-name">Name</Label>
            <Input id="new-folder-name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New folder" autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit">Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

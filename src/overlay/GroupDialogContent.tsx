// Content-only port of the old inline "New tab group" <Dialog> in
// routes/index.tsx (see BookmarkDialogContent.tsx's header comment for why
// the plain Dialog/DialogContent primitives work unmodified inside a
// "cover"-mode overlay window).
import { useState } from "react";
import { Check, FolderPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TAB_GROUP_COLORS, type GroupDialogOverlayAction, type GroupDialogOverlayPayload } from "@/overlay/types";

export function GroupDialogContent({
  payload,
  onAction,
  onClose,
}: {
  payload: GroupDialogOverlayPayload;
  onAction: (action: GroupDialogOverlayAction) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(payload.defaultColor);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4" />
            New tab group
          </DialogTitle>
          <DialogDescription>Name and color for the group.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New group" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex gap-2">
              {TAB_GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full ring-offset-2 transition-all"
                  style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }}
                >
                  {color === c && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onAction({ type: "create", tabId: payload.tabId, name: name.trim() || "New group", color })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

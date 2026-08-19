// Right-click menu for a single favorites-bar item (src/components/
// HeaderFavoritesBar.tsx) — hosted in the native overlay window, same
// "atPoint" placement as the page's own right-click menu (see
// ContextMenuContent.tsx, whose ContextMenuActionItem this duplicates
// rather than imports, for the same reason ContextMenuContent duplicates
// it from index.tsx: this overlay route is a deliberately separate,
// minimal renderer entry point).
import { Clipboard, Copy, ExternalLink, Eye, FolderMinus, FolderPlus, Pencil, Scissors, SquareArrowOutUpRight, Trash2, UserRoundX } from "lucide-react";
import type { FavoriteContextMenuOverlayAction, FavoriteContextMenuOverlayPayload } from "@/overlay/types";

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted disabled:cursor-default disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
    >
      <Icon className="h-[15px] w-[15px] shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function FavoriteContextMenuContent({
  payload,
  onAction,
}: {
  payload: FavoriteContextMenuOverlayPayload;
  onAction: (action: FavoriteContextMenuOverlayAction) => void;
}) {
  const { id, url, iconOnly, inFolder } = payload;

  return (
    <div className="w-64 overflow-hidden rounded-2xl border border-border bg-white p-1.5">
      <div className="flex flex-col">
        <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => onAction({ type: "openInNewTab", url })} />
        <MenuItem icon={SquareArrowOutUpRight} label="Open in new window" onClick={() => onAction({ type: "openInNewWindow", url })} />
        <MenuItem icon={UserRoundX} label="Open in InPrivate window" onClick={() => onAction({ type: "openInIncognitoWindow", url })} />
      </div>

      <div className="mx-1 my-1 h-px bg-border" />

      <div className="flex flex-col">
        <MenuItem icon={Pencil} label="Edit" onClick={() => onAction({ type: "edit", id })} />
        <MenuItem icon={Eye} label={iconOnly ? "Show icon and name" : "Show icon only"} onClick={() => onAction({ type: "toggleIconOnly", id, iconOnly: !iconOnly })} />
        {!inFolder && <MenuItem icon={FolderPlus} label="New folder" onClick={() => onAction({ type: "newFolder" })} />}
        {inFolder && <MenuItem icon={FolderMinus} label="Remove from folder" onClick={() => onAction({ type: "removeFromFolder", id })} />}
      </div>

      <div className="mx-1 my-1 h-px bg-border" />

      <div className="flex flex-col">
        <MenuItem icon={Scissors} label="Cut" onClick={() => onAction({ type: "cut", id, url })} />
        <MenuItem icon={Copy} label="Copy" onClick={() => onAction({ type: "copy", url })} />
        {/* Paste is deliberately inert — there's no "paste a favorite from
            the clipboard" feature anywhere else in the app to wire this
            to, same as the reference (Edge) shows it greyed out when
            there's nothing pasteable. Rendered disabled rather than
            omitted so the menu shape matches what was asked for. */}
        <MenuItem icon={Clipboard} label="Paste" disabled />
      </div>

      <div className="mx-1 my-1 h-px bg-border" />

      <MenuItem icon={Trash2} label="Delete" onClick={() => onAction({ type: "delete", id })} />
    </div>
  );
}

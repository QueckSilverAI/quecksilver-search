// Content-only port of the context-menu half of the old inline JSX in
// routes/index.tsx (the `{contextMenu && (...)}` block), now hosted inside
// the native overlay window instead of a DOM popup over a screenshot
// backdrop of the frozen page — see electron/main.ts's showContextMenu
// (Phase 4b of the native-overlay plan) for where this gets opened from.
import { useState } from "react";
import {
  ArrowLeft,
  Camera,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Languages,
  Link2,
  Printer,
  QrCode,
  RotateCw,
  Search,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { ContextMenuOverlayAction, ContextMenuOverlayPayload } from "@/overlay/types";

// Same tiny component as index.tsx's own (unexported) ContextMenuActionItem
// — duplicated rather than imported for the same reason ProfilePopupContent
// duplicates Avatar/nameFromEmail: this overlay route is a deliberately
// separate, minimal renderer entry point.
function ContextMenuActionItem({
  icon: Icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted"
    >
      <Icon className="h-[15px] w-[15px] shrink-0 text-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <span className="shrink-0 text-[11px] text-muted-foreground">{shortcut}</span>}
    </button>
  );
}

// Ctrl on Windows/Linux, Cmd on macOS — same platform check SettingsView.tsx
// already uses for its own shortcut-recorder display.
const MOD = typeof navigator !== "undefined" && navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";

export function ContextMenuContent({
  payload,
  onAction,
}: {
  payload: ContextMenuOverlayPayload;
  onAction: (action: ContextMenuOverlayAction) => void;
}) {
  const { srcURL, linkURL, selectionText, isEmptyPage, pageUrl } = payload;
  // QR code renders directly inline here rather than as a dispatched
  // action — same reasoning/pattern as ControlCenterContent's own "QR code
  // of URL" button (this overlay kind has no onNotify wired at all, only
  // onAction, which closes the menu — a dispatched action couldn't show
  // anything back inside it anyway).
  const [showQr, setShowQr] = useState(false);

  return (
    <div className="w-64 overflow-hidden rounded-2xl border border-border bg-white p-1.5">
      {srcURL && (
        <div className="flex flex-col">
          <ContextMenuActionItem
            icon={Download}
            label="Save image"
            onClick={() => onAction({ type: "saveImage", url: srcURL })}
          />
          <ContextMenuActionItem
            icon={Download}
            label="Save image as…"
            onClick={() => onAction({ type: "saveImageAs", url: srcURL })}
          />
          <ContextMenuActionItem
            icon={Copy}
            label="Copy image"
            onClick={() => onAction({ type: "copyImage", url: srcURL })}
          />
          <ContextMenuActionItem
            icon={Link2}
            label="Copy image address"
            onClick={() => onAction({ type: "copyLink", url: srcURL })}
          />
          <ContextMenuActionItem
            icon={ExternalLink}
            label="Open image in new tab"
            onClick={() => onAction({ type: "openLinkInNewTab", url: srcURL })}
          />
        </div>
      )}

      {srcURL && linkURL && <div className="mx-1 my-1 h-px bg-border" />}

      {linkURL && (
        <div className="flex flex-col">
          <ContextMenuActionItem
            icon={ExternalLink}
            label="Open link in new tab"
            onClick={() => onAction({ type: "openLinkInNewTab", url: linkURL })}
          />
          <ContextMenuActionItem
            icon={Copy}
            label="Copy link"
            onClick={() => onAction({ type: "copyLink", url: linkURL })}
          />
          <ContextMenuActionItem
            icon={SquareArrowOutUpRight}
            label="Open link in new window"
            onClick={() => onAction({ type: "openLinkInNewWindow", url: linkURL })}
          />
          <ContextMenuActionItem
            icon={Download}
            label="Save link as…"
            onClick={() => onAction({ type: "saveLinkAs", url: linkURL })}
          />
          <ContextMenuActionItem
            icon={Link2}
            label="Open link"
            onClick={() => onAction({ type: "openLinkHere", url: linkURL })}
          />
        </div>
      )}

      {selectionText && !srcURL && !linkURL && (
        <div className="flex flex-col">
          <ContextMenuActionItem
            icon={Copy}
            label="Copy"
            onClick={() => onAction({ type: "copySelection" })}
          />
          <ContextMenuActionItem
            icon={Search}
            label={`Search the web for "${selectionText.length > 24 ? selectionText.slice(0, 24) + "…" : selectionText}"`}
            onClick={() => onAction({ type: "searchSelection", text: selectionText })}
          />
        </div>
      )}

      {isEmptyPage && (
        <div className="flex flex-col">
          <ContextMenuActionItem
            icon={ArrowLeft}
            label="Back"
            shortcut="Alt+←"
            onClick={() => onAction({ type: "goBack" })}
          />
          <ContextMenuActionItem
            icon={RotateCw}
            label="Reload"
            shortcut={`${MOD}+R`}
            onClick={() => onAction({ type: "reload" })}
          />

          <div className="mx-1 my-1 h-px bg-border" />

          <ContextMenuActionItem
            icon={Download}
            label="Save page as…"
            shortcut={`${MOD}+S`}
            onClick={() => onAction({ type: "savePageAs" })}
          />
          <ContextMenuActionItem
            icon={Printer}
            label="Print"
            shortcut={`${MOD}+P`}
            onClick={() => onAction({ type: "print" })}
          />

          <div className="mx-1 my-1 h-px bg-border" />

          {showQr && pageUrl ? (
            <div className="flex flex-col items-center gap-1.5 px-3 py-2">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(pageUrl)}`}
                alt="QR code for this page"
                className="h-[160px] w-[160px] rounded-lg border border-border"
              />
            </div>
          ) : (
            <ContextMenuActionItem
              icon={QrCode}
              label="Generate QR code for this page"
              onClick={() => setShowQr(true)}
            />
          )}

          <div className="mx-1 my-1 h-px bg-border" />

          <ContextMenuActionItem
            icon={Languages}
            label="Translate to English"
            onClick={() => onAction({ type: "translateToEnglish" })}
          />

          <div className="mx-1 my-1 h-px bg-border" />

          <ContextMenuActionItem
            icon={Camera}
            label="Screenshot"
            shortcut={`${MOD}+Shift+S`}
            onClick={() => onAction({ type: "screenshot" })}
          />

          <div className="mx-1 my-1 h-px bg-border" />

          <ContextMenuActionItem
            icon={Code2}
            label="Inspect"
            shortcut="F12"
            onClick={() => onAction({ type: "openDevTools" })}
          />
        </div>
      )}
    </div>
  );
}

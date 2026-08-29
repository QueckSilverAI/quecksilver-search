// Content-only port of the tab strip's hover-preview card into the native
// overlay window — see electron/overlay-window.ts's class comment for why
// this needs to be a real, separate native window rather than a plain DOM
// popup: a tab's live native WebContentsView always paints ABOVE this
// window's own chrome-UI webContents regardless of CSS z-index, so a
// plain absolutely/fixed-positioned DOM element here would get covered by
// the very page content it's supposed to float above. Purely
// informational (no onAction — see TabPreviewOverlayPayload's own
// comment), opened/closed by TabStrip.tsx's hover timer, not a click.
import type { TabPreviewOverlayPayload } from "@/overlay/types";

export function TabPreviewContent({ payload }: { payload: TabPreviewOverlayPayload }) {
  const { imageBase64, title, host, favicon } = payload;
  return (
    // No box-shadow here on purpose — same reasoning as
    // ProfilePopupContent.tsx/TabsMenuContent.tsx: the native overlay
    // window is sized EXACTLY to this div's own measured bounds (see
    // reportSize in overlay-window.ts), and box-shadow paints outside
    // those bounds without affecting layout size, so it gets hard-clipped
    // into a visible rectangular edge right where the window ends instead
    // of fading out — that's the shadow artifact this had. The border
    // alone is enough.
    <div className="w-[220px] overflow-hidden rounded-xl border border-border bg-white">
      <img src={`data:image/png;base64,${imageBase64}`} alt="" className="block h-[124px] w-full object-cover object-top" />
      <div className="flex flex-col gap-0.5 border-t border-border px-2.5 py-1.5">
        <span className="truncate text-[12px] font-medium text-foreground">{title}</span>
        {host && (
          <span className="flex items-center gap-1 truncate text-[11px] text-foreground">
            {favicon && <img src={favicon} alt="" className="h-3 w-3 shrink-0 object-contain" />}
            {host}
          </span>
        )}
      </div>
    </div>
  );
}

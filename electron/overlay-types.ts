// Shared between overlay-window.ts (main), overlay-preload.ts, and the
// renderer's overlay route (src/routes/overlay.tsx). Kept dependency-free
// (no Electron imports) for the same reason as electron/types.ts.

// One entry per overlay "kind" this app knows how to render. Extend this
// as more overlays get migrated off the screenshot-backdrop approach (see
// Phase 4 of the plan) — ProfilePopup and the right-click context menu are
// the first two.
export type OverlayKind = "profile" | "contextmenu" | "bookmark" | "groupDialog" | "tabSearch" | "downloads" | "favoriteContextMenu" | "favoriteEditDialog" | "favoriteFolder" | "newFavoriteFolderDialog" | "tabsMenu";

// Window-relative rect (getBoundingClientRect() shape) of whatever the
// overlay should visually hang off — the profile button, or the exact
// click point for the context menu. Main process turns this into absolute
// screen coordinates (see overlay-window.ts).
//
// placement controls which corner of the anchor rect the overlay panel is
// pinned to: "belowRight" (default) opens below the anchor with its right
// edge aligned to anchor.right — matches a browser's account-switcher
// dropdown (ProfilePopup). "atPoint" opens with its TOP-LEFT corner AT
// (anchor.left, anchor.top) — matches a native right-click context menu.
// "cover" ignores the anchor rect entirely and sizes/positions the overlay
// to exactly cover the owner window's full content area — for centered
// modal dialogs (bookmark editor, new-group, tab search) that need to dim
// the ENTIRE app, not hang off one button. Because the overlay window is a
// real, separate, transparent native window, a semi-transparent backdrop
// drawn inside it actually dims the live page underneath — something the
// old DOM-only backdrop could never do (native content always painted
// above it), which is why those dialogs used to need the tab hidden and a
// frozen screenshot shown instead.
export type OverlayAnchor = { top: number; left: number; right: number; bottom: number; placement?: "belowRight" | "atPoint" | "cover" };

// Generic envelope — payload is kind-specific and untyped here on purpose
// (profile.tsx / contextmenu.tsx narrow it themselves), same pattern as
// ContextMenuRequestPayload already used for the old screenshot-backdrop
// menu in preload.ts.
export type OverlayOpenRequest = {
  kind: OverlayKind;
  payload: unknown;
  anchor: OverlayAnchor;
};

export type OverlayInitMessage = {
  kind: OverlayKind;
  payload: unknown;
};

// Sent back from the overlay window to whichever main window opened it,
// once the person actually picks something (or the overlay renderer wants
// to report its own measured size — see OverlaySizeReport below).
export type OverlayAction = { kind: OverlayKind; action: unknown };

export type OverlaySizeReport = { width: number; height: number };

// A plain in-memory module variable — both the toolbar buttons (index.tsx)
// and SettingsView live in the same renderer process, so this is simpler
// than sessionStorage for something this transient.
//
// Also fires an immediate listener, not just a "read on mount" value —
// clicking Edit/Download while ALREADY viewing Settings doesn't cause
// SettingsView to unmount/remount at all (its own isSettings flag never
// actually changes), so a mount-only effect would silently never re-fire
// for that case. The listener lets an already-mounted SettingsView react
// right away instead.
let pending: string | null = null;
let listener: ((id: string) => void) | null = null;

export function setPendingSettingsAnchor(id: string) {
  if (listener) {
    listener(id);
  } else {
    pending = id;
  }
}

export function takePendingSettingsAnchor(): string | null {
  const id = pending;
  pending = null;
  return id;
}

export function subscribeSettingsAnchor(cb: (id: string) => void): () => void {
  listener = cb;
  return () => {
    if (listener === cb) listener = null;
  };
}

// Per-tab, localStorage-backed drafts for text typed into the header
// address bar and the Start page's own search bar but never actually
// submitted. Both bars are lifted, single-instance React state in
// routes/index.tsx (urlDraft / homeUrlDraft / secondaryHomeUrlDraft) — on
// its own that's fine while a tab stays active, but switching tabs
// re-syncs those fields against the newly active tab (real URL, or blank
// for Home/Settings), which silently threw away whatever was mid-typed.
// Persisting each keystroke here, keyed by the tab's own id, is what lets
// the sync effects check "was something being typed here?" before
// blanking the field, so coming back to a tab shows the draft exactly as
// it was left — same as a real browser's address bar.
//
// Tab ids are backend-issued UUIDs (electron/tab-manager.ts) that are
// never reused for a different tab, so they're a safe, collision-free
// localStorage key on their own. The header bar and the Start page's own
// search bar are still two DIFFERENT input fields that can both have
// unsubmitted text on the very same Home tab at once, so they each get
// their own key prefix — sharing one would let typing in one field
// silently overwrite whatever was stored for the other.
type DraftKind = "header" | "home";

function storageKey(kind: DraftKind, tabId: string): string {
  return `qs-${kind}-draft:${tabId}`;
}

function readDraft(kind: DraftKind, tabId: string | null | undefined): string {
  if (!tabId) return "";
  try {
    return window.localStorage.getItem(storageKey(kind, tabId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(kind: DraftKind, tabId: string | null | undefined, value: string): void {
  if (!tabId) return;
  try {
    if (value) window.localStorage.setItem(storageKey(kind, tabId), value);
    // Empty string means nothing worth restoring — remove instead of
    // storing "", so a closed/never-typed-in tab doesn't leave a key
    // behind forever.
    else window.localStorage.removeItem(storageKey(kind, tabId));
  } catch {
    // Storage unavailable/full (private mode quirks, quota) — the draft
    // just won't survive a tab switch, nothing else should break over it.
  }
}

// Header address bar.
export function getUrlDraft(tabId: string | null | undefined): string {
  return readDraft("header", tabId);
}
export function setUrlDraftStored(tabId: string | null | undefined, value: string): void {
  writeDraft("header", tabId, value);
}
// Called once a draft is superseded by something real: the tab actually
// navigated (submitted/opened a bookmark) or the tab closed. Without this,
// every submitted URL would leave a stale, never-cleaned-up entry behind
// under that tab's id.
export function clearUrlDraft(tabId: string | null | undefined): void {
  writeDraft("header", tabId, "");
}

// Start page's own centered search bar.
export function getHomeSearchDraft(tabId: string | null | undefined): string {
  return readDraft("home", tabId);
}
export function setHomeSearchDraftStored(tabId: string | null | undefined, value: string): void {
  writeDraft("home", tabId, value);
}
export function clearHomeSearchDraft(tabId: string | null | undefined): void {
  writeDraft("home", tabId, "");
}

// Called when a tab closes for good — drops any leftover draft under
// either namespace so localStorage doesn't accumulate an entry per tab
// that ever existed.
export function clearAllDraftsForTab(tabId: string | null | undefined): void {
  clearUrlDraft(tabId);
  clearHomeSearchDraft(tabId);
}

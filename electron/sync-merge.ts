// Shared merge logic for anything synced to Supabase as a list of items
// with an id (passwords, header favorites). Two devices editing the same
// profile between syncs is the actual conflict case — the previous
// implementation just pushed each device's full local array, so whichever
// device happened to push last silently wiped out anything the other had
// added or changed in between. This merges item-by-item instead.

export type Syncable = { id: string; updatedAt?: number; deletedAt?: number };

// A deleted item can't just be dropped from the array on the device that
// deleted it — the other device, still holding its own copy, would see
// that id "missing" from the remote and (since union-merging can't tell
// "never existed" apart from "deleted") merge it right back in. Keeping a
// tombstone (the id + a deletedAt marker, deletedAt wins ties the same way
// updatedAt normally does) for a while is what actually lets a deletion
// propagate. 30 days is generous — plenty of time for every linked device
// to have synced at least once — while still not growing the array forever.
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Merges two versions of the same list: for each id, keep whichever side
// has the newer updatedAt (a tombstone's deletedAt counts as its
// updatedAt for this comparison — a delete after an edit should still win).
// Purges tombstones past the retention window from the result.
export function mergeById<T extends Syncable>(local: T[], remote: T[]): T[] {
  const stampOf = (item: T) => item.deletedAt ?? item.updatedAt ?? 0;
  const merged = new Map<string, T>();
  for (const item of remote) merged.set(item.id, item);
  for (const item of local) {
    const existing = merged.get(item.id);
    if (!existing || stampOf(item) >= stampOf(existing)) merged.set(item.id, item);
  }

  // Content is merged above (newest per-id wins), but ARRAY ORDER still
  // needs deciding separately — a pure reorder (drag-and-drop) doesn't
  // change any item's content, so no single id "wins" a fresher stamp from
  // it, and building `merged` by iterating remote-then-local (as above)
  // always ends up positioned in REMOTE's order regardless of what just
  // got reordered locally. That's exactly why a drag-reorder used to snap
  // back after the next sync. Instead: whichever side was touched more
  // recently overall (see diffAndTombstone below, which stamps a pure
  // reorder's items too) decides the order for ids both sides share;
  // anything only on the other side is appended after, in its own order.
  const maxStamp = (items: T[]) => items.reduce((m, item) => Math.max(m, stampOf(item)), 0);
  const localIsNewer = maxStamp(local) >= maxStamp(remote);
  const orderBase = localIsNewer ? local : remote;
  const other = localIsNewer ? remote : local;

  const ordered: T[] = [];
  const placed = new Set<string>();
  for (const item of orderBase) {
    const val = merged.get(item.id);
    if (val && !placed.has(item.id)) {
      ordered.push(val);
      placed.add(item.id);
    }
  }
  for (const item of other) {
    const val = merged.get(item.id);
    if (val && !placed.has(item.id)) {
      ordered.push(val);
      placed.add(item.id);
    }
  }

  const now = Date.now();
  return ordered.filter((item) => !item.deletedAt || now - item.deletedAt < TOMBSTONE_RETENTION_MS);
}

// Called right before writing a "replace the whole list" save (header
// favorites are edited as a full array in the renderer, not via
// add/update/remove primitives like passwords are) — diffs the incoming
// array against what was there before so every item still carries an
// accurate updatedAt, and turns anything that disappeared into a tombstone
// instead of just letting it vanish (see mergeById above for why that
// matters). Tombstones are invisible to callers of the "list" read — see
// favorites-store.ts's filter — they only exist to make deletions survive
// a sync merge.
export function diffAndTombstone<T extends Syncable>(previous: T[], next: T[]): T[] {
  const now = Date.now();
  const prevById = new Map(previous.map((item) => [item.id, item]));
  const nextIds = new Set(next.map((item) => item.id));
  // A pure reorder (same set of ids, nobody's content actually changed)
  // gives no individual item a content diff below — which meant the
  // reorder itself left no trace for mergeById to notice, and the drag
  // silently reverted to remote's stale order on the next sync. Detecting
  // "same ids, different sequence" here and refreshing every item's
  // updatedAt makes this side's overall recency reflect the reorder, which
  // is what mergeById (sync-merge.ts) now uses to decide whose ORDER wins.
  const sameIds = previous.length === next.length && previous.every((p) => nextIds.has(p.id));
  const orderChanged = sameIds && previous.some((p, i) => p.id !== next[i]?.id);
  const result: T[] = next.map((item) => {
    const prev = prevById.get(item.id);
    const contentChanged = !prev || JSON.stringify({ ...prev, updatedAt: undefined }) !== JSON.stringify({ ...item, updatedAt: undefined });
    return contentChanged || orderChanged ? { ...item, updatedAt: now } : item;
  });
  for (const prev of previous) {
    if (!nextIds.has(prev.id) && !prev.deletedAt) {
      result.push({ ...prev, deletedAt: now, updatedAt: now });
    }
  }
  return result;
}

export function withoutTombstones<T extends Syncable>(items: T[]): T[] {
  return items.filter((item) => !item.deletedAt);
}

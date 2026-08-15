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
  const now = Date.now();
  return [...merged.values()].filter((item) => !item.deletedAt || now - item.deletedAt < TOMBSTONE_RETENTION_MS);
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
  const result: T[] = next.map((item) => {
    const prev = prevById.get(item.id);
    const changed = !prev || JSON.stringify({ ...prev, updatedAt: undefined }) !== JSON.stringify({ ...item, updatedAt: undefined });
    return changed ? { ...item, updatedAt: now } : item;
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

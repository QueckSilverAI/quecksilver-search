// Populated in privacy.ts whenever a top-level http:// request gets
// silently upgraded to https://, read in tab-manager.ts's did-fail-load
// handler — if that upgraded https:// URL then fails to load, this is
// what lets it know the original http:// address to either silently
// retry (HTTPS-Only off) or offer as an explicit "continue anyway" choice
// (HTTPS-Only on), instead of just showing a generic connection error
// that doesn't mention https was ever involved.
const upgradedFrom = new Map<string, string>();
// URLs explicitly allowed to load as plain http once — either the
// HTTPS-Only-off fallback below, or someone clicking "continue anyway" on
// the httpsOnlyBlockedPage warning. Without this, re-navigating to the
// same http:// URL would just get silently upgraded to https again by
// privacy.ts's normal upgrade logic, which is exactly the failing
// address that led here in the first place — an infinite loop.
const httpExemptOnce = new Set<string>();

export function allowHttpOnce(url: string) {
  httpExemptOnce.add(url);
}

export function consumeHttpExemption(url: string): boolean {
  const had = httpExemptOnce.has(url);
  httpExemptOnce.delete(url);
  return had;
}

export function recordHttpsUpgrade(httpsUrl: string, originalHttpUrl: string) {
  upgradedFrom.set(httpsUrl, originalHttpUrl);
  // Capped — this only ever needs to cover requests currently in flight,
  // not accumulate forever.
  if (upgradedFrom.size > 500) {
    const firstKey = upgradedFrom.keys().next().value;
    if (firstKey) upgradedFrom.delete(firstKey);
  }
}

export function getOriginalHttpUrl(httpsUrl: string): string | null {
  return upgradedFrom.get(httpsUrl) ?? null;
}

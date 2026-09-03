import { JsonStore } from "./json-store";

// Control center's per-site "X off for this site" toggles. Started as
// adblock-exceptions-store.ts (ad blocker only); generalized into one
// shared domain -> overrides map once the same "global toggle, no
// per-site escape hatch" pattern turned out to affect five more
// features (cookies, images, JavaScript, autoplay, popups) — six
// nearly-identical stores/IPC channels/UI rows would've meant one bug
// fixed six times over instead of once.
//
// A feature key present and true means "this global feature is
// switched OFF for this domain" (an exception/allowlist entry) —
// absence means "still follows the global Control center setting",
// matching every underlying xEnabled()/xBlocked()-style default.
// Nothing is written just for visiting a site, only for an explicit
// per-site flip.
//
// Not profile-scoped: none of the underlying global settings
// (control-center-store.ts) are either, and a per-site exception is a
// much smaller, more casual decision than a saved password or
// bookmark — no strong reason for it to differ between profiles on the
// same machine.
export type SiteOverridableFeature =
  "adBlock" | "cookies" | "images" | "javascript" | "autoplay" | "popups";

type DomainOverrides = Partial<Record<SiteOverridableFeature, true>>;
type SiteFeatureOverrides = Record<string, DomainOverrides>;

const store = new JsonStore<SiteFeatureOverrides>("site-feature-overrides.json");

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

export function isFeatureDisabledForDomain(
  feature: SiteOverridableFeature,
  domain: string,
): boolean {
  return store.read({})[normalizeDomain(domain)]?.[feature] === true;
}

// Backs the Control center's per-site toggle row for a single feature —
// used directly wherever only one feature's state matters (privacy.ts's
// request hooks, tab-manager.ts's popup/JS/autoplay checks).
export function setFeatureDisabledForDomain(
  feature: SiteOverridableFeature,
  domain: string,
  disabled: boolean,
) {
  const map = store.read({});
  const key = normalizeDomain(domain);
  const entry = { ...(map[key] ?? {}) };
  if (disabled) {
    entry[feature] = true;
  } else {
    delete entry[feature];
  }
  if (Object.keys(entry).length === 0) {
    delete map[key];
  } else {
    map[key] = entry;
  }
  store.write(map);
}

// Backs the Control center panel's per-site section, which needs every
// feature's state for the active tab's domain at once (one IPC round
// trip instead of six).
export function getOverridesForDomain(domain: string): DomainOverrides {
  return store.read({})[normalizeDomain(domain)] ?? {};
}

import { JsonStore } from "./json-store";

// Control center's "Custom CSS pro Domain" (masterplan #16) — a domain ->
// CSS string map, persisted the same JsonStore way as every other small
// store here. Kept in its own file (not folded into control-center-store)
// since it isn't a single settings blob — it grows one entry per domain
// the person has customized, closer in shape to site-permissions-store.ts
// than to a plain toggle set.
type CustomCssMap = Record<string, string>;

const store = new JsonStore<CustomCssMap>("custom-css.json");

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

export function getCustomCssForDomain(domain: string): string {
  const map = store.read({});
  return map[normalizeDomain(domain)] ?? "";
}

export function setCustomCssForDomain(domain: string, css: string) {
  const map = store.read({});
  const key = normalizeDomain(domain);
  if (css.trim()) {
    map[key] = css;
  } else {
    delete map[key];
  }
  store.write(map);
}

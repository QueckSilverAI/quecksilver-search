import { JsonStore } from "./json-store";

// DuckDuckGo, not Google — Juri's explicit choice for this app's default.
const DEFAULT_ENGINE = "duckduckgo";

type SearchSettings = { engine: string; onionize: boolean };

const store = new JsonStore<SearchSettings>("search-engine.json");

function read(): SearchSettings {
  const raw = store.read({ engine: DEFAULT_ENGINE, onionize: false });
  return { engine: raw.engine || DEFAULT_ENGINE, onionize: raw.onionize === true };
}

export function getSearchEngineSetting(): string {
  return read().engine;
}

export function setSearchEngineSetting(engine: string): void {
  store.write({ ...read(), engine });
}

// "Onionize" (zora-browser-integration-plan.md is silent on this one —
// added directly at Juri's request, Aug 2026): when on AND the engine is
// DuckDuckGo, searches go to DuckDuckGo's real Tor onion service
// (duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion — the
// genuine, current v3 address, verified, not a placeholder) instead of
// duckduckgo.com. Only meaningful in a Tor window, where traffic is
// already routed through Tor and can actually resolve a .onion address —
// see url-bar.ts for where this is applied.
export function getOnionizeSetting(): boolean {
  return read().onionize;
}

export function setOnionizeSetting(onionize: boolean): void {
  store.write({ ...read(), onionize });
}

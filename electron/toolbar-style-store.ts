import { JsonStore } from "./json-store";

// "underline-slide" — kept in sync with DEFAULT_STYLE in
// src/lib/toolbar-style.ts, which is the source of truth for the full
// list of style ids.
const DEFAULT_STYLE = "underline-slide";

type ToolbarStyleSettings = { style: string };

const store = new JsonStore<ToolbarStyleSettings>("toolbar-style.json");

export function getToolbarStyleSetting(): string {
  const raw = store.read({ style: DEFAULT_STYLE }).style;
  return raw || DEFAULT_STYLE;
}

export function setToolbarStyleSetting(style: string): void {
  store.write({ style });
}

// Inline page translation: walks the active tab's DOM for visible text
// nodes, sends them to the translate-page edge function (via
// translate-client.ts), and writes the translations back into the same
// nodes. Unlike the earlier translate.google.com approach, the tab never
// navigates — the URL bar keeps showing the real page.
//
// The extraction/injection halves run as a string inside the target page's
// own context via webContents.executeJavaScript (same technique tab-manager
// already uses for e.g. reader-mode detection) rather than a preload script,
// since this only needs to run once per translate action, not on every load.

import type { WebContents } from "electron";
import { translateTexts } from "./translate-client";

// Marks a node as already-translated so re-running translate (e.g. picking
// a different target language) walks the DOM again cleanly instead of
// re-translating already-translated text or losing the mapping.
const TRANSLATED_ATTR = "data-qs-translated";

// Runs inside the page. Collects visible text nodes not already translated,
// tags each with a data-qs-translate-id so the injection step can find the
// exact same node again after the async round-trip to the edge function.
const EXTRACT_SCRIPT = `
(() => {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "CODE", "PRE"]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue ? node.nodeValue.trim() : "";
      if (!text) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[${TRANSLATED_ATTR}]')) return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const segments = [];
  let node;
  let id = 0;
  while ((node = walker.nextNode())) {
    const segId = "qs-t-" + id++;
    node.parentElement.setAttribute("data-qs-translate-id", segId);
    segments.push({ id: segId, text: node.nodeValue });
  }
  return segments;
})();
`;

// Runs inside the page after translation. Looks each node back up by the id
// stamped during extraction and swaps in the translated text, then marks it
// so a second translate pass (or the extractor re-running) skips it.
function buildInjectScript(pairs: Array<{ id: string; text: string }>): string {
  return `
(() => {
  const pairs = ${JSON.stringify(pairs)};
  for (const { id, text } of pairs) {
    const el = document.querySelector('[data-qs-translate-id="' + id + '"]');
    if (!el) continue;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.nodeValue && child.nodeValue.trim()) {
        child.nodeValue = text;
        break;
      }
    }
    el.setAttribute("${TRANSLATED_ATTR}", "");
    el.removeAttribute("data-qs-translate-id");
  }
})();
`;
}

export type TranslatePageResult = { ok: true; detectedSourceLang?: string } | { ok: false; error: string };

// Translates the given WebContents' current page into targetLang in place.
// Safe to call again with a different language — each run only walks nodes
// that aren't already marked as translated (i.e. a fresh page or newly
// revealed content), so switching languages twice in a row re-translates
// from the page's current (possibly already-translated) text rather than
// the true original. Reload the page first if the original is needed again.
export async function translatePageInPlace(
  webContents: WebContents,
  targetLang: string,
): Promise<TranslatePageResult> {
  let segments: Array<{ id: string; text: string }>;
  try {
    segments = await webContents.executeJavaScript(EXTRACT_SCRIPT);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "extraction failed" };
  }

  if (segments.length === 0) return { ok: true };

  const result = await translateTexts(
    segments.map((s) => s.text),
    targetLang,
  );
  if ("error" in result) return { ok: false, error: result.error };

  const pairs = segments.map((s, i) => ({ id: s.id, text: result.translations[i] ?? s.text }));
  try {
    await webContents.executeJavaScript(buildInjectScript(pairs));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "injection failed" };
  }

  return { ok: true, detectedSourceLang: result.detectedSourceLang };
}

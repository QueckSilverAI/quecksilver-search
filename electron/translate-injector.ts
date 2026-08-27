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
//
// Wraps each qualifying text node in its own marker <span> rather than
// stamping the id on its existing parent element. Stamping the parent used
// to break on the extremely common case of a parent with MORE than one
// direct text-node child around some inline markup — e.g.
// "Read this <b>important</b> update" has THREE text-node children of the
// same <p> ("Read this ", inside <b> doesn't count, " update"), and
// setAttribute just overwrote the same attribute on the same <p> for each
// one in turn, so only the LAST segment's id "won" on that parent. The
// injection step below then found nothing for the first segment's id (its
// translation silently vanished) and wrote the LAST segment's translation
// into the FIRST text-node child it found under that id (visibly scrambled/
// wrong text) — exactly the "sentences with bold/italic/links in the
// middle come out garbled" symptom. A dedicated wrapper per text node gives
// every segment its own unique, unambiguous element to find and update, no
// matter how many sibling text runs share the same original parent. This
// is the same technique real "translate this page" implementations use for
// exactly this reason — TreeWalker itself is well-defined to keep
// traversing correctly across the DOM mutation this causes.
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
    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-qs-translate-id", segId);
    node.parentNode.insertBefore(wrapper, node);
    wrapper.appendChild(node);
    segments.push({ id: segId, text: node.nodeValue });
  }
  return segments;
})();
`;

// Runs inside the page after translation. Looks each wrapper span back up
// by the id stamped during extraction and swaps in the translated text,
// then marks it so a second translate pass (or the extractor re-running)
// skips it. Each span wraps exactly one original text node and nothing
// else, so setting textContent directly is always correct — no more
// "guess which child text node this segment meant" ambiguity.
function buildInjectScript(pairs: Array<{ id: string; text: string }>): string {
  return `
(() => {
  const pairs = ${JSON.stringify(pairs)};
  for (const { id, text } of pairs) {
    const el = document.querySelector('[data-qs-translate-id="' + id + '"]');
    if (!el) continue;
    el.textContent = text;
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

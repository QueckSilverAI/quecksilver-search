// Reader/Leseansicht (masterplan #15): turns the active tab's page into a
// clean, ad-free text view, and back again. Runs entirely as a single
// injected script via webContents.executeJavaScript — same technique
// translate-injector.ts already uses (see its header comment) — rather
// than pulling in @mozilla/readability + jsdom into the main process: the
// extraction needs a REAL DOM to score against (computed styles, actual
// layout), which is exactly what the page's own already-loaded document
// inside the renderer provides for free. A lightweight paragraph-density
// heuristic (the same core idea Readability itself is built on: score
// candidate containers by amount of real paragraph text, pick the winner)
// covers the common "article page" case without the extra dependency
// weight.
//
// Toggling is handled entirely inside the injected script itself (stashes
// the original body HTML on `window` before replacing it, restores it on
// the next call) — main.ts just calls this once per click, it doesn't
// need to track per-tab reader-mode state itself.

import type { WebContents } from "electron";

// Shared with markdown-export-injector.ts (masterplan #21 explicitly
// reuses #15's extraction — see that file's header comment) — a plain JS
// function *definition* as a string, prepended into whichever injected
// script needs it, since executeJavaScript calls are independent
// evaluations with no shared module scope to import a real function
// from.
export const FIND_MAIN_CONTENT_FN = `
function qsFindMainContent() {
  const SKIP_TAGS = new Set(["SCRIPT","STYLE","NOSCRIPT","NAV","HEADER","FOOTER","ASIDE","IFRAME","FORM","BUTTON"]);
  function textDensity(el) {
    let paragraphChars = 0;
    let linkChars = 0;
    const paragraphs = el.querySelectorAll("p");
    for (const p of paragraphs) paragraphChars += (p.textContent || "").trim().length;
    const links = el.querySelectorAll("a");
    for (const a of links) linkChars += (a.textContent || "").trim().length;
    return { paragraphChars, linkChars, paragraphCount: paragraphs.length };
  }
  const candidates = new Set();
  document.querySelectorAll("article, main, [role=main]").forEach((el) => candidates.add(el));
  document.querySelectorAll("div, section").forEach((el) => {
    if (SKIP_TAGS.has(el.tagName)) return;
    if (el.querySelectorAll("p").length >= 3) candidates.add(el);
  });
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    const { paragraphChars, linkChars, paragraphCount } = textDensity(el);
    if (paragraphChars < 200) continue;
    const score = paragraphChars - linkChars * 1.5 + paragraphCount * 20;
    if (score > bestScore) { bestScore = score; best = el; }
  }
  return best;
}
`;

const TOGGLE_SCRIPT = `
(() => {
  const MARK = "data-qs-reader-active";
  if (document.documentElement.hasAttribute(MARK)) {
    if (window.__qsReaderOriginalHtml !== undefined) {
      document.body.innerHTML = window.__qsReaderOriginalHtml;
      delete window.__qsReaderOriginalHtml;
    }
    document.documentElement.removeAttribute(MARK);
    const style = document.getElementById("qs-reader-style");
    if (style) style.remove();
    return "exited";
  }

  ${FIND_MAIN_CONTENT_FN}
  const best = qsFindMainContent();
  if (!best) return "no-content";

  const title = (document.querySelector("h1")?.textContent || document.title || "").trim();
  const clone = best.cloneNode(true);
  clone.querySelectorAll("script, style, nav, header, footer, aside, iframe, form, button, [class*=share], [class*=comment], [class*=advert], [id*=advert]")
    .forEach((n) => n.remove());

  window.__qsReaderOriginalHtml = document.body.innerHTML;

  const style = document.createElement("style");
  style.id = "qs-reader-style";
  style.textContent = \`
    body { background: #fbfaf8 !important; }
    .qs-reader-article {
      max-width: 680px; margin: 0 auto; padding: 48px 24px 96px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 19px; line-height: 1.7; color: #1a1a1a;
    }
    .qs-reader-article h1 { font-size: 32px; line-height: 1.25; margin: 0 0 24px; font-family: -apple-system, sans-serif; }
    .qs-reader-article img { max-width: 100%; height: auto; }
    .qs-reader-article a { color: #1a1a1a; }
    .qs-reader-article p { margin: 0 0 20px; }
  \`;
  document.head.appendChild(style);

  const wrapper = document.createElement("div");
  wrapper.className = "qs-reader-article";
  const h1 = document.createElement("h1");
  h1.textContent = title;
  wrapper.appendChild(h1);
  wrapper.appendChild(clone);

  document.body.innerHTML = "";
  document.body.appendChild(wrapper);
  document.documentElement.setAttribute(MARK, "");
  return "entered";
})();
`;

export type ReaderModeResult = "entered" | "exited" | "no-content" | "error";

export async function toggleReaderMode(webContents: WebContents): Promise<ReaderModeResult> {
  try {
    const result = await webContents.executeJavaScript(TOGGLE_SCRIPT, true);
    return (result as ReaderModeResult) ?? "error";
  } catch {
    return "error";
  }
}

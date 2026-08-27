// Seite als Markdown exportieren (masterplan #21). Reuses the exact same
// main-content extraction as Reader Mode (#15) — see
// reader-mode-injector.ts's FIND_MAIN_CONTENT_FN, shared verbatim as the
// plan itself calls for. Converting the resulting HTML to Markdown is a
// small, self-contained walker rather than pulling in the `turndown`
// dependency: it only has to cover the tags a real article actually uses
// (headings, paragraphs, links, lists, emphasis, images, blockquotes,
// code), and running as a plain injected function means it needs no
// bundling step of its own, same reasoning as the Reader Mode trade-off.

import type { WebContents } from "electron";
import { FIND_MAIN_CONTENT_FN } from "./reader-mode-injector";

const EXTRACT_MARKDOWN_SCRIPT = `
(() => {
  ${FIND_MAIN_CONTENT_FN}
  const best = qsFindMainContent();
  if (!best) return null;

  function inline(el) {
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue.replace(/\\s+/g, " ");
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName;
      if (tag === "BR") { out += "\\n"; continue; }
      if (tag === "STRONG" || tag === "B") { out += "**" + inline(node).trim() + "**"; continue; }
      if (tag === "EM" || tag === "I") { out += "_" + inline(node).trim() + "_"; continue; }
      if (tag === "CODE") { out += "\`" + node.textContent + "\`"; continue; }
      if (tag === "A") {
        const href = node.getAttribute("href") || "";
        out += "[" + inline(node).trim() + "](" + href + ")";
        continue;
      }
      if (tag === "IMG") {
        const alt = node.getAttribute("alt") || "";
        const src = node.getAttribute("src") || "";
        out += "![" + alt + "](" + src + ")";
        continue;
      }
      out += inline(node);
    }
    return out;
  }

  function block(el, lines) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.COMMENT_NODE) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue.trim();
        if (text) lines.push(text);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName;
      if (/^H[1-6]$/.test(tag)) {
        lines.push("#".repeat(Number(tag[1])) + " " + inline(node).trim());
      } else if (tag === "P") {
        const text = inline(node).trim();
        if (text) lines.push(text);
      } else if (tag === "BLOCKQUOTE") {
        lines.push("> " + inline(node).trim());
      } else if (tag === "UL" || tag === "OL") {
        let i = 1;
        for (const li of node.children) {
          if (li.tagName !== "LI") continue;
          const marker = tag === "OL" ? (i++ + ".") : "-";
          lines.push(marker + " " + inline(li).trim());
        }
      } else if (tag === "PRE") {
        lines.push("\`\`\`\\n" + node.textContent.trim() + "\\n\`\`\`");
      } else if (tag === "IMG") {
        const alt = node.getAttribute("alt") || "";
        const src = node.getAttribute("src") || "";
        lines.push("![" + alt + "](" + src + ")");
      } else if (tag === "A") {
        // A link that's a direct block-level child (not wrapped in a <p> —
        // a standalone "Read more" link, or a linked image used as its own
        // element) used to fall through to the generic "else" branch below,
        // which just recurses into it as if it were a plain container —
        // losing the href entirely, since inline()'s A-handling (the code
        // that actually knows how to produce "[text](href)") only runs for
        // an <a> found while walking a PARENT's children, never for the
        // <a> itself when it's the thing being visited at the top level.
        // Mirrors inline()'s own A case exactly, just invoked here for the
        // block-level case that never reached it.
        const href = node.getAttribute("href") || "";
        const text = inline(node).trim();
        if (text) lines.push("[" + text + "](" + href + ")");
      } else if (tag === "HR") {
        lines.push("---");
      } else {
        block(node, lines);
      }
    }
  }

  const title = (document.querySelector("h1")?.textContent || document.title || "").trim();
  const lines = [];
  if (title) lines.push("# " + title, "");
  block(best, lines);
  return { title, markdown: lines.join("\\n\\n") };
})();
`;

export type MarkdownExportResult =
  | { ok: true; title: string; markdown: string }
  | { ok: false };

export async function extractPageAsMarkdown(webContents: WebContents): Promise<MarkdownExportResult> {
  try {
    const result = await webContents.executeJavaScript(EXTRACT_MARKDOWN_SCRIPT, true);
    if (!result) return { ok: false };
    return { ok: true, title: result.title, markdown: result.markdown };
  } catch {
    return { ok: false };
  }
}

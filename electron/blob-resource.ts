import path from "node:path";
import { existsSync } from "node:fs";
import type { WebContents } from "electron";

// Reads a blob: URL's bytes from INSIDE the renderer that created it. A
// blob: URL is just a key into that renderer's own in-memory Blob
// registry, not a network resource — Electron's net.fetch and
// session.downloadURL() (both main-process-side) can never resolve one no
// matter which session they're given. Chat UIs (Claude, QueckSilver AI's
// own chat) commonly render message images this way — fetched once with
// auth, then handed to the page as URL.createObjectURL(blob) — which is
// why "Copy image" / "Save image" / "Open image in new tab" worked fine
// on an ordinary <img src="https://..."> page but silently failed on
// those. Base64 is just the transport across the executeJavaScript
// boundary back to the main process; the content-type comes along too so
// callers can pick a sensible file extension / data: URL mime instead of
// always guessing "png".
const FETCH_BLOB_SCRIPT = (url: string) => `(() => {
  return fetch(${JSON.stringify(url)})
    .then((res) => res.blob().then((blob) => ({ blob, type: res.headers.get("content-type") || blob.type || "" })))
    .then(({ blob, type }) => blob.arrayBuffer().then((buf) => ({ buf, type })))
    .then(({ buf, type }) => {
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return { base64: btoa(binary), mime: type };
    });
})()`;

export async function fetchBlobResource(
  url: string,
  sourceWebContents?: WebContents | null,
): Promise<{ buffer: Buffer; mime: string }> {
  if (!sourceWebContents || sourceWebContents.isDestroyed()) {
    throw new Error("Can't read this — its page isn't open anymore.");
  }
  const result = (await sourceWebContents.executeJavaScript(FETCH_BLOB_SCRIPT(url), true)) as {
    base64: string;
    mime: string;
  };
  return { buffer: Buffer.from(result.base64, "base64"), mime: result.mime || "application/octet-stream" };
}

// data: URLs are entirely self-contained — the bytes are already sitting
// right there in the string itself — so unlike blob: they never need a
// renderer round-trip at all, just parsing. They DO need their own
// special-casing anyway: Electron's net.fetch (electron/main.ts's
// fetchImageBuffer, used for ordinary http(s) URLs) does not support the
// data: scheme — a documented Electron limitation, nothing to do with the
// page itself — so "Copy image"/"Save image" silently failed the exact
// same way for a data:-sourced image as they did for a blob:-sourced one.
// This is exactly how QueckSilver AI's and Claude's own chat UIs render
// on-the-fly generated images (QR codes, attachments) inline: as a data:
// URL, not a blob: one — same underlying "net.fetch can't reach it" wall,
// different scheme. Returns null (not a throw) for anything that isn't
// actually a data: URL, so callers can just fall through to their next
// case on a null result.
export function parseDataUrl(url: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(url);
  if (!match) return null;
  const [, rawMime, isBase64, payload] = match;
  const mime = rawMime || "text/plain";
  const buffer = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf-8");
  return { buffer, mime };
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
};

export function extensionForMime(mime: string, fallback = "png"): string {
  return MIME_EXTENSIONS[mime.toLowerCase().split(";")[0].trim()] || fallback;
}

// Picks "name.ext", or "name (1).ext", "name (2).ext", ... — same
// collision convention the OS/most browsers use for a straight-to-folder
// save, so a second blob-sourced download doesn't clobber the first.
export function uniqueDownloadPath(dir: string, baseName: string, ext: string): string {
  let dest = path.join(dir, `${baseName}.${ext}`);
  let n = 1;
  while (existsSync(dest)) {
    dest = path.join(dir, `${baseName} (${n}).${ext}`);
    n++;
  }
  return dest;
}

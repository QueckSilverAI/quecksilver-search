// Masterplan #56 — decodes a JWT's header/payload for display, NO
// signature check (this is a read-only convenience, not an auth
// mechanism). A JWT is just three base64url segments joined by ".", so
// this is plain string-splitting + atob(), no library needed — matches
// the masterplan's own note that this doesn't warrant a dependency.
export type DecodedJwt = {
  header: unknown;
  payload: unknown;
  signature: string;
};

function base64UrlDecode(segment: string): string {
  // base64url -> base64: swap the two characters that differ, then pad
  // to a multiple of 4 (atob throws on unpadded input).
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  // atob() gives back a binary string; JWTs are UTF-8 JSON, so this needs
  // the usual escape/decodeURIComponent round-trip to handle non-ASCII
  // claim values correctly instead of mangling them.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

// Returns null for anything that isn't a plausible three-segment JWT —
// callers should treat that as "not a token", not throw a visible error.
export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts;
  if (!headerPart || !payloadPart || signature === undefined) return null;
  try {
    const header = JSON.parse(base64UrlDecode(headerPart));
    const payload = JSON.parse(base64UrlDecode(payloadPart));
    return { header, payload, signature };
  } catch {
    return null;
  }
}

// Stripped before a navigation is even allowed to happen (see
// tab-manager.ts's "will-navigate" listener) — not cleaned up after the
// fact, so the tracking parameters are never actually sent to the
// destination server at all, not just hidden from the address bar
// afterward.
const TRACKING_PARAMS = new Set([
  // Google/Google Ads
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "utm_name", "gclid", "gclsrc", "dclid", "gbraid", "wbraid",
  // Meta/Facebook
  "fbclid", "fb_action_ids", "fb_action_types", "fb_source",
  // Microsoft
  "msclkid",
  // Mailchimp
  "mc_eid", "mc_cid",
  // Instagram/Twitter/TikTok
  "igshid", "ref_src", "ref_url", "twclid", "ttclid",
  // Yandex
  "yclid",
  // Generic/vendor click-tracking
  "_hsenc", "_hsmi", "hsCtaTracking", "mkt_tok", "vero_id", "vero_conv", "oly_anon_id", "oly_enc_id", "wickedid", "igsh",
]);

// Returns null when nothing changed (so the caller doesn't have to
// re-navigate to an identical URL, which would just add a pointless
// duplicate history/navigation entry).
export function stripTrackingParams(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null; // not a real absolute URL — nothing to do
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  let removedAny = false;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key)) {
      url.searchParams.delete(key);
      removedAny = true;
    }
  }
  if (!removedAny) return null;
  return url.toString();
}

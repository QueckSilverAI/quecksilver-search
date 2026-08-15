// Google Safe Browsing v4 "Lookup API" check, proxied through the
// check-url-safety Supabase Edge Function (supabase/functions/check-url-safety)
// instead of calling Google directly from this process.
//
// Why the indirection: this used to hold SAFE_BROWSING_API_KEY directly and
// call Google from here. That meant the key had to be baked into every
// distributed .exe (env vars don't survive on a user's machine unless
// hardcoded as a fallback, same as SUPABASE_ANON_KEY in ./config.ts) —
// but unlike the Supabase anon key, a Safe Browsing key is billed to a
// Google Cloud project and not meant to be public, so shipping it in the
// binary would let anyone unpack app.asar and drain/abuse it. Routing
// through the edge function means only Supabase (via its secrets store)
// ever sees the key; this file just calls the function with the public
// anon key, same as search-chat already does.
//
// "Not configured" is a no-op here too: if the function's own
// SAFE_BROWSING_API_KEY secret isn't set, the function itself fails open
// and returns { safe: true }, so this module never blocks browsing on a
// missing/misconfigured key — it just never warns either.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

const CHECK_URL_SAFETY_URL = `${SUPABASE_URL}/functions/v1/check-url-safety`;

type SafetyResult = { safe: true } | { safe: false; threatType: string };

// domain -> { result, checkedAt } — capped lifetime so a domain that gets
// added to (or removed from) Safe Browsing's list later is eventually
// re-checked instead of trusting a verdict forever.
const cache = new Map<string, { result: SafetyResult; checkedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function checkUrlSafety(url: string): Promise<SafetyResult> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { safe: true };
  }

  const cached = cache.get(hostname);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached.result;

  try {
    const res = await fetch(CHECK_URL_SAFETY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return { safe: true }; // function/API hiccup — fail open, never block browsing on our own error
    const result = (await res.json()) as SafetyResult;
    cache.set(hostname, { result, checkedAt: Date.now() });
    return result;
  } catch {
    return { safe: true }; // network error — same fail-open reasoning
  }
}

// Was previously used to hide the phishing-guard UI entirely when no key
// was configured. Now always true from the client's point of view — the
// key lives (or doesn't) in the edge function, not here — so this always
// returns true and the warning page is available whenever the edge
// function is reachable and returns a match.
export function isPhishingGuardConfigured(): boolean {
  return true;
}

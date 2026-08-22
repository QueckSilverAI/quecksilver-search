// Thin client for the translate-page Supabase Edge Function
// (supabase/functions/translate-page). Same reasoning as phishing-guard.ts:
// GOOGLE_TRANSLATE_API_KEY only ever lives in the edge function's secret
// store, never in this process or the distributed binary — this module just
// calls the function with the public anon key, same as checkUrlSafety does.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

const TRANSLATE_PAGE_URL = `${SUPABASE_URL}/functions/v1/translate-page`;

// Mirrors the edge function's own limit — chunk here so a long page still
// works instead of failing outright on the 400 the function would return.
const MAX_SEGMENTS_PER_REQUEST = 128;

export type TranslateBatchResult = { translations: string[]; detectedSourceLang?: string } | { error: string };

async function translateChunk(texts: string[], targetLang: string): Promise<TranslateBatchResult> {
  try {
    const res = await fetch(TRANSLATE_PAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ texts, targetLang }),
    });
    const json = await res.json();
    if (!res.ok) return { error: json?.error ?? `translate-page returned ${res.status}` };
    return json as TranslateBatchResult;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "network error" };
  }
}

// Translates an arbitrary number of text segments, chunking transparently
// so callers (the injector) don't need to know about the per-request cap.
// Returns translations in the same order/length as the input, or an error
// for the whole batch — a partial chunk failure fails the whole call since
// a half-translated page would look broken, not helpful.
export async function translateTexts(texts: string[], targetLang: string): Promise<TranslateBatchResult> {
  if (texts.length === 0) return { translations: [] };

  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += MAX_SEGMENTS_PER_REQUEST) {
    chunks.push(texts.slice(i, i + MAX_SEGMENTS_PER_REQUEST));
  }

  const translations: string[] = [];
  let detectedSourceLang: string | undefined;
  for (const chunk of chunks) {
    const result = await translateChunk(chunk, targetLang);
    if ("error" in result) return result;
    translations.push(...result.translations);
    detectedSourceLang ??= result.detectedSourceLang;
  }
  return { translations, detectedSourceLang };
}

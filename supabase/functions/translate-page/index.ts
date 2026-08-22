// Supabase Edge Function: translate-page
//
// Server-side proxy for the Google Cloud Translation API v2. Used for the
// "inline" page-translate flow: the renderer's translate-injector walks the
// active tab's DOM, collects the visible text nodes, sends them here in a
// batch, and writes the translated strings back into the same nodes — the
// tab's URL never changes (unlike the earlier translate.google.com
// URL-rewrite approach this replaces).
//
// Same reasoning as check-url-safety: GOOGLE_TRANSLATE_API_KEY is billed to
// a Google Cloud project and must never ship inside app.asar, so only this
// function (via its Supabase secret) ever sees it. The client only needs
// the public Supabase anon key, same as check-url-safety/search-chat.
//
// Deploy with:
//   supabase functions deploy translate-page
// Then set the secret once (this does NOT happen automatically from the
// dashboard "Edge Functions -> Secrets" UI unless you deploy afterwards):
//   supabase secrets set GOOGLE_TRANSLATE_API_KEY=your_key_here

const GOOGLE_TRANSLATE_API_KEY = Deno.env.get("GOOGLE_TRANSLATE_API_KEY") ?? "";
const GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";

// Google's v2 endpoint accepts multiple "q" params per request but both
// URL length and per-request cost grow with it — the injector chunks
// larger pages into multiple calls rather than raising this.
const MAX_SEGMENTS_PER_REQUEST = 128;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TranslateRequestBody = {
  texts: string[];
  targetLang: string;
  sourceLang?: string; // omitted/"auto" -> let Google detect it
};

type TranslateResult =
  | { translations: string[]; detectedSourceLang?: string }
  | { error: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" } satisfies TranslateResult), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: TranslateRequestBody;
  try {
    const parsed = await req.json();
    if (!Array.isArray(parsed?.texts) || parsed.texts.length === 0) throw new Error("missing texts");
    if (typeof parsed?.targetLang !== "string" || !parsed.targetLang) throw new Error("missing targetLang");
    body = parsed;
  } catch {
    return new Response(
      JSON.stringify({
        error: "Expected JSON body with a non-empty 'texts' array and a 'targetLang' string",
      } satisfies TranslateResult),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (body.texts.length > MAX_SEGMENTS_PER_REQUEST) {
    return new Response(
      JSON.stringify({
        error: `Too many segments (${body.texts.length}). Max ${MAX_SEGMENTS_PER_REQUEST} per request — chunk on the client.`,
      } satisfies TranslateResult),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Not configured on this project yet — same "fail visibly but don't
  // crash the caller" shape as check-url-safety's fail-open, except here
  // there's no safe default translation, so we return a clear error the
  // injector can surface instead of silently no-op'ing.
  if (!GOOGLE_TRANSLATE_API_KEY) {
    return new Response(JSON.stringify({ error: "Translation not configured" } satisfies TranslateResult), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const params = new URLSearchParams();
    params.set("key", GOOGLE_TRANSLATE_API_KEY);
    params.set("target", body.targetLang);
    params.set("format", "text"); // plain text nodes, not HTML fragments
    if (body.sourceLang && body.sourceLang !== "auto") params.set("source", body.sourceLang);
    for (const text of body.texts) params.append("q", text);

    const gRes = await fetch(`${GOOGLE_TRANSLATE_URL}?${params.toString()}`, { method: "POST" });

    if (!gRes.ok) {
      const detail = await gRes.text();
      console.error("[translate-page] Google Translate API error:", gRes.status, detail);
      return new Response(JSON.stringify({ error: "Translation failed" } satisfies TranslateResult), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = (await gRes.json()) as {
      data: { translations: Array<{ translatedText: string; detectedSourceLanguage?: string }> };
    };
    const translations = data.data.translations.map((t) => t.translatedText);
    const detectedSourceLang = data.data.translations[0]?.detectedSourceLanguage;

    return new Response(JSON.stringify({ translations, detectedSourceLang } satisfies TranslateResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[translate-page] request failed:", err);
    return new Response(JSON.stringify({ error: "Translation failed" } satisfies TranslateResult), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

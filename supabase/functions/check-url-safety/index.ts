// Supabase Edge Function: check-url-safety
//
// Server-side proxy for the Google Safe Browsing v4 "Lookup API". The
// Electron app used to call Google directly from the main process with
// SAFE_BROWSING_API_KEY read from process.env — but that key would have
// to be baked into every distributed .exe, where anyone can pull it back
// out of app.asar. Routing through here instead means only this function
// (running on Supabase, not on the user's machine) ever sees the key.
// The client only needs the public Supabase anon key, same as it already
// does for search-chat.
//
// Deploy with:
//   supabase functions deploy check-url-safety
// Then set the secret once (this does NOT happen automatically from the
// dashboard "Edge Functions -> Secrets" UI unless you deploy afterwards):
//   supabase secrets set SAFE_BROWSING_API_KEY=your_key_here

const SAFE_BROWSING_API_KEY = Deno.env.get("SAFE_BROWSING_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SafetyResult = { safe: true } | { safe: false; threatType: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let url: string;
  try {
    const body = await req.json();
    url = body?.url;
    if (typeof url !== "string" || !url) throw new Error("missing url");
  } catch {
    return new Response(JSON.stringify({ error: "Expected JSON body with a 'url' field" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Not configured on this project yet - fail open (never block browsing),
  // same reasoning the old client-side version used.
  if (!SAFE_BROWSING_API_KEY) {
    return new Response(JSON.stringify({ safe: true } satisfies SafetyResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const gRes = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${SAFE_BROWSING_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "quecksilver-search", clientVersion: "1.0.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
    });

    if (!gRes.ok) {
      // Upstream hiccup - fail open, don't block browsing on our own error.
      return new Response(JSON.stringify({ safe: true } satisfies SafetyResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = (await gRes.json()) as { matches?: { threatType: string }[] };
    const result: SafetyResult =
      data.matches && data.matches.length > 0 ? { safe: false, threatType: data.matches[0]!.threatType } : { safe: true };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[check-url-safety] request failed:", err);
    return new Response(JSON.stringify({ safe: true } satisfies SafetyResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

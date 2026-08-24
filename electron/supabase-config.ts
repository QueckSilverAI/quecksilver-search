// Mirrors src/lib/supabase-config.ts's constants for the electron/ (main
// process) side — kept as its own small file rather than importing across
// the electron/src boundary (electron/ is a separate Node build target,
// not bundled with the renderer). Only the plain public endpoint URLs;
// no secrets here — same public functions the renderer already calls
// directly for search-chat, callable with no user auth (rate-limited by
// IP only), same as tts/image-search always have been.
export const SUPABASE_URL = "https://pwdncixmwxedfhtiwpmt.supabase.co";
export const TTS_URL = `${SUPABASE_URL}/functions/v1/tts`;
export const IMAGE_SEARCH_URL = `${SUPABASE_URL}/functions/v1/image-search`;
export const WEB_SEARCH_URL_URL = `${SUPABASE_URL}/functions/v1/web-search-url`;

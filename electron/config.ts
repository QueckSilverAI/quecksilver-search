// Same Supabase project as QueckSilver AI (src/integrations/supabase/client.ts).
// SUPABASE_ANON_KEY is the public "publishable" anon key — safe to ship in a
// client app, same as it already is in QAI's bundled frontend JS.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://pwdncixmwxedfhtiwpmt.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3ZG5jaXhtd3hlZGZodGl3cG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNjE1NTIsImV4cCI6MjA5MDgzNzU1Mn0.z4qrH2YuBkVv9CbAOFNdbXD0wwAF8y-zCR584un_y9o";

// The web app that hosts the /search-auth authorization page.
export const WEB_APP_URL = process.env.QUECKSILVER_WEB_URL ?? "https://quecksilver.ch";

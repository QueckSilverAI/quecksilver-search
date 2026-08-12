// Same Supabase project as QueckSilver AI (src/integrations/supabase/client.ts)
// and electron/config.ts. Public anon key — safe to ship client-side.
export const SUPABASE_URL = "https://pwdncixmwxedfhtiwpmt.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3ZG5jaXhtd3hlZGZodGl3cG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNjE1NTIsImV4cCI6MjA5MDgzNzU1Mn0.z4qrH2YuBkVv9CbAOFNdbXD0wwAF8y-zCR584un_y9o";

export const SEARCH_CHAT_URL = `${SUPABASE_URL}/functions/v1/search-chat`;

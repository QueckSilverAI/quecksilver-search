import { BrowserWindow, shell } from "electron";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ProfileScopedStore } from "./profile-scoped-store";
import { SUPABASE_ANON_KEY, SUPABASE_URL, WEB_APP_URL } from "./config";
import type { AuthSession } from "./types";

// Per-profile — each QueckSilver-linked profile has its own session file
// (profiles/<id>/session.json), only ever read/written while that profile
// is the active one for the requesting window (see profile-scoped-store.ts).
// When signing in to CREATE a new profile, main.ts creates + activates that
// profile (via profile-store.ts) inside the onEmailKnown hook below, before
// the session itself gets written — so this store always resolves to the
// right file.
const sessionStore = new ProfileScopedStore<AuthSession>("session.json", null);

// Access tokens are short-lived (Supabase default ~1h) and this flow — same
// as QueckSilver CLI's — only ever receives the access token, no refresh
// token. So a stored session can go stale; callers should treat a 401 from
// search-chat as "call login() again" rather than assuming this is durable.
export function getSession(windowId: number): AuthSession {
  return sessionStore.read(windowId, null);
}

export function logout(windowId: number) {
  sessionStore.write(windowId, null);
}

const CALLBACK_HTML = (message: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>QueckSilver Arch</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh;
         margin: 0; background: #f7f8fa; color: #1a1a1a; }
  p { font-size: 15px; color: #6b6a66; }
</style></head>
<body><p>${message} You can close this window.</p></body></html>`;

// Per-window — two windows could each independently be running their own
// "add profile" login flow at the same time (each is its own localhost
// callback server), so one window's login must never cancel or overwrite
// another's.
const pending = new Map<number, { server: http.Server; reject: (err: Error) => void }>();

// Lets the renderer cancel an in-flight login — without this, clicking
// "Sign in" and then never finishing the flow in the system browser (just
// closing that tab, or changing your mind) left the button stuck reading
// "Signing in…" until the timeout below eventually fired, minutes later.
export function cancelLoginFlow(windowId: number) {
  const entry = pending.get(windowId);
  if (!entry) return;
  entry.server.close();
  entry.reject(new Error("login_cancelled"));
  pending.delete(windowId);
}

// Opens the user's default system browser (never our own chrome UI or a
// WebContentsView) to the /search-auth confirmation page, and spins up a
// short-lived localhost server to receive the token it hands back —
// mirrors QueckSilver CLI's `quecksilver login` flow exactly.
//
// onEmailKnown fires once the email is fetched but BEFORE the session is
// written — main.ts uses this to create + activate a new profile (add-
// profile flow) or leave the already-active one alone (re-authenticating
// an existing profile whose token went stale), so the session always lands
// in the right profile's own file.
export async function startLoginFlow(win: BrowserWindow, onEmailKnown: (email: string | null) => void): Promise<AuthSession> {
  const windowId = win.id;
  pending.get(windowId)?.server.close();
  pending.delete(windowId);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404).end();
        return;
      }

      const url = new URL(req.url, "http://127.0.0.1");
      const token = url.searchParams.get("token");

      if (!token) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(CALLBACK_HTML("Login failed - no token received."));
        server.close();
        pending.delete(windowId);
        reject(new Error("no_token"));
        return;
      }

      let email: string | null = null;
      let userId: string | null = null;
      try {
        const user = await fetchUser(token);
        email = user?.email ?? null;
        userId = user?.id ?? null;
      } catch (err) {
        console.error("[auth] failed to fetch user info:", err);
      }

      onEmailKnown(email);

      const session: AuthSession = { accessToken: token, userId, email, obtainedAt: Date.now() };
      sessionStore.write(windowId, session);

      res.writeHead(200, { "Content-Type": "text/html" }).end(CALLBACK_HTML("Signed in to QueckSilver Arch."));
      server.close();
      pending.delete(windowId);
      win.webContents.send("auth:changed", session);
      resolve(session);
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const redirect = `http://127.0.0.1:${port}/callback`;
      const authUrl = `${WEB_APP_URL}/search-auth?redirect=${encodeURIComponent(redirect)}`;
      shell.openExternal(authUrl);
    });

    server.on("error", (err) => {
      pending.delete(windowId);
      reject(err);
    });

    pending.set(windowId, { server, reject });

    // Was 5 minutes — long enough that "stuck on Signing in…" was a
    // reasonable thing to conclude well before it ever fired on its own.
    // The explicit cancelLoginFlow() above is now the primary way out of a
    // login that's abandoned in the system browser; this timeout is just a
    // backstop for the case where the renderer/button somehow never gets a
    // chance to call it.
    setTimeout(() => {
      if (pending.get(windowId)?.server === server) {
        server.close();
        pending.delete(windowId);
        reject(new Error("login_timeout"));
      }
    }, 2 * 60 * 1000);
  });
}

async function fetchUser(accessToken: string): Promise<{ id: string; email?: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string; email?: string };
}
